//! WORTH admission and retention of provider session receipts used by replay verification.

use worth_query_host::facade::primary_graph;

use super::{
    denied, recovery_binding, stale, validation::valid_verification_evidence,
    InterfaceCompilerReplacementVerification, InterfaceCompilerReplayRecoveryEntity,
    InterfaceCompilerReplayRecoveryOutcome, InterfaceCompilerReplayRecoveryStage,
    RegisterVerificationEvidenceRequest, MAX_RECOVERY_JSON_BYTES,
    REQUIRED_REPLACEMENT_VERIFICATION_RUNS,
};
use crate::application::{
    CapabilityActiveReplayIdentifier, CapabilityCandidateReplayIdentifier, CapabilityIdentifier,
    CapabilityRevision, CapabilityStatus, InterfaceCompilerSchema, RegisterVerificationEvidence,
    RegisterVerificationEvidenceInput, Replay, ReplayCapabilityIdentifier, ReplayIdentifier,
    ReplayRevision, ReplayStatus, ReplayVerificationJson,
};
use crate::host::InterfaceCompilerWorthHost;

type Admission = primary_graph::WorthQueryAdmittedApplicationOperation<
    InterfaceCompilerSchema,
    RegisterVerificationEvidence,
    RegisterVerificationEvidenceInput,
    Replay,
>;
type ReplayIdentity =
    primary_graph::WorthQueryApplicationEntityIdentity<InterfaceCompilerSchema, Replay>;

impl InterfaceCompilerWorthHost {
    pub fn register_verification_evidence(
        &self,
        request: RegisterVerificationEvidenceRequest,
    ) -> InterfaceCompilerReplayRecoveryOutcome {
        if !super::valid_context(&request.credential, request.timeout)
            || !super::valid_identity(&request.capability_id, "capability.")
            || !super::valid_identity(&request.replay_version_id, "replay.")
            || !super::valid_wire_revision(request.expected_capability_revision)
            || !super::valid_wire_revision(request.expected_replay_revision)
            || !valid_verification_evidence(&request.evidence)
            || request.evidence.replay_version_id != request.replay_version_id
        {
            return denied(
                InterfaceCompilerReplayRecoveryStage::Request,
                "the verification evidence request is malformed",
            );
        }
        let scope = super::super::settlement_support::scope(request.timeout);
        let principal = match self.authenticate_execution_principal(&request.credential, &scope) {
            Ok(value) => value,
            Err(outcome) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::Authentication,
                    format!("WORTH principal admission denied verification evidence: {outcome:?}"),
                )
            }
        };
        let replay = match self.application.resolve_entity(
            ReplayIdentifier::reference(),
            request.replay_version_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::EntityResolution,
                    format!("candidate replay resolution denied: {error:?}"),
                )
            }
        };
        let operation = match self
            .application
            .installed_schema()
            .installed_operation(RegisterVerificationEvidence::reference())
        {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                    format!("verification evidence operation unavailable: {error:?}"),
                )
            }
        };
        let admission: Admission = match self.application.authorize_operation(
            &principal,
            &replay,
            &operation,
            Default::default(),
            &scope,
        ) {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                    format!("WORTH denied verification evidence admission: {error:?}"),
                )
            }
        };
        let admitted = match admit_evidence(self, &request, &admission) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        commit_evidence(self, &request, &replay, admission, admitted)
    }
}

type Projection = primary_graph::WorthQueryApplicationOperationInvariantProjectionSnapshot<
    InterfaceCompilerSchema,
    RegisterVerificationEvidence,
>;

struct EvidenceAdmission {
    projection: Projection,
    next_replay_revision: u64,
    retained_json: String,
}

fn admit_evidence(
    host: &InterfaceCompilerWorthHost,
    request: &RegisterVerificationEvidenceRequest,
    admission: &Admission,
) -> Result<EvidenceAdmission, InterfaceCompilerReplayRecoveryOutcome> {
    let (state, projection, _) = host
        .invariant
        .project_admitted_operation(admission, |reader, replay| {
            let capability = reader
                .resolve_entity(
                    CapabilityIdentifier::reference(),
                    request.capability_id.clone(),
                )
                .expect("admitted evidence can resolve its capability");
            (
                reader
                    .decision_field(&capability, CapabilityIdentifier::reference())
                    .ok()
                    .flatten(),
                reader
                    .decision_field(&capability, CapabilityRevision::reference())
                    .ok()
                    .flatten(),
                reader
                    .decision_field(&capability, CapabilityStatus::reference())
                    .ok()
                    .flatten(),
                reader
                    .decision_field(&capability, CapabilityActiveReplayIdentifier::reference())
                    .ok()
                    .flatten(),
                reader
                    .decision_field(
                        &capability,
                        CapabilityCandidateReplayIdentifier::reference(),
                    )
                    .ok()
                    .flatten(),
                reader
                    .decision_field(replay, ReplayIdentifier::reference())
                    .ok()
                    .flatten(),
                reader
                    .decision_field(replay, ReplayRevision::reference())
                    .ok()
                    .flatten(),
                reader
                    .decision_field(replay, ReplayCapabilityIdentifier::reference())
                    .ok()
                    .flatten(),
                reader
                    .decision_field(replay, ReplayStatus::reference())
                    .ok()
                    .flatten(),
                reader
                    .decision_field(replay, ReplayVerificationJson::reference())
                    .ok()
                    .flatten(),
            )
        })
        .map_err(|error| {
            denied(
                InterfaceCompilerReplayRecoveryStage::DependencyProjection,
                format!("verification evidence projection denied: {error:?}"),
            )
        })?
        .into_parts();
    let (
        capability_id,
        capability_revision,
        capability_status,
        active_replay,
        candidate_replay,
        replay_id,
        replay_revision,
        replay_capability,
        replay_status,
        verification_json,
    ) = state;
    for (entity, id, expected, actual) in [
        (
            InterfaceCompilerReplayRecoveryEntity::Capability,
            request.capability_id.as_str(),
            request.expected_capability_revision,
            capability_revision.unwrap_or(u64::MAX),
        ),
        (
            InterfaceCompilerReplayRecoveryEntity::Replay,
            request.replay_version_id.as_str(),
            request.expected_replay_revision,
            replay_revision.unwrap_or(u64::MAX),
        ),
    ] {
        if expected != actual {
            return Err(stale(entity, id.to_string(), expected, actual));
        }
    }
    let candidate_lineage = capability_status.as_deref() == Some("verifying")
        && candidate_replay.as_deref() == Some(request.replay_version_id.as_str())
        && replay_status.as_deref() == Some("verifying");
    let active_lineage = capability_status.as_deref() == Some("healthy")
        && active_replay.as_deref() == Some(request.replay_version_id.as_str())
        && replay_status.as_deref() == Some("active");
    if capability_id.as_deref() != Some(request.capability_id.as_str())
        || (!candidate_lineage && !active_lineage)
        || replay_id.as_deref() != Some(request.replay_version_id.as_str())
        || replay_capability.as_deref() != Some(request.capability_id.as_str())
    {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "verification evidence does not belong to the current candidate or active replay",
        ));
    }
    let mut verification = verification_json
        .as_deref()
        .and_then(|value| {
            serde_json::from_str::<InterfaceCompilerReplacementVerification>(value).ok()
        })
        .filter(|value| value.required_successful_runs == REQUIRED_REPLACEMENT_VERIFICATION_RUNS)
        .ok_or_else(|| {
            denied(
                InterfaceCompilerReplayRecoveryStage::DependencyProjection,
                "candidate verification state is malformed",
            )
        })?;
    if verification.evidence.iter().any(|evidence| {
        evidence.evidence_id == request.evidence.evidence_id
            || evidence.session_id == request.evidence.session_id
    }) {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "verification evidence or session identity was already retained",
        ));
    }
    verification.evidence.push(request.evidence.clone());
    let retained_json =
        serde_json::to_string(&verification).expect("validated verification evidence serializes");
    if retained_json.len() > MAX_RECOVERY_JSON_BYTES {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "retained verification evidence exceeds the recovery projection bound",
        ));
    }
    let next_replay_revision = replay_revision
        .and_then(|revision| revision.checked_add(1))
        .ok_or_else(|| {
            denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                "replay revision exhausted",
            )
        })?;
    Ok(EvidenceAdmission {
        projection,
        next_replay_revision,
        retained_json,
    })
}

fn commit_evidence(
    host: &InterfaceCompilerWorthHost,
    request: &RegisterVerificationEvidenceRequest,
    replay: &ReplayIdentity,
    admission: Admission,
    admitted: EvidenceAdmission,
) -> InterfaceCompilerReplayRecoveryOutcome {
    let dependencies = match host
        .application
        .begin_projected_application_read_attempt(admission, admitted.projection)
        .and_then(|reads| reads.complete_projected_dependencies())
    {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::DependencyProjection,
                format!("verification evidence dependencies were not current: {error:?}"),
            )
        }
    };
    let mut effects = dependencies.begin_effect_program();
    let target = match effects.existing_entity(replay) {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("verification evidence target denied: {error:?}"),
            )
        }
    };
    if let Err(error) = effects
        .write_field(
            &target,
            ReplayRevision::reference(),
            admitted.next_replay_revision,
        )
        .and_then(|_| {
            effects.write_field(
                &target,
                ReplayVerificationJson::reference(),
                admitted.retained_json,
            )
        })
    {
        return denied(
            InterfaceCompilerReplayRecoveryStage::EffectProgram,
            format!("verification evidence effects denied: {error:?}"),
        );
    }
    let program = match effects.finish() {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("verification evidence program denied: {error:?}"),
            )
        }
    };
    let intent =
        serde_json::to_vec(&request.evidence).expect("validated verification evidence serializes");
    let commit = match host.settle_recovery_commit(host.application.compare_and_commit_application(
        program,
        recovery_binding(
            b"register-verification-evidence",
            &request.evidence.evidence_id,
            &request.replay_version_id,
            &intent,
        ),
    )) {
        Ok(value) => value,
        Err(outcome) => return outcome,
    };
    host.project_recovery(
        &request.capability_id,
        &request.replay_version_id,
        &request.credential,
        request.timeout,
        commit,
    )
}
