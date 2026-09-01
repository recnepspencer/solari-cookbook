use worth_query_host::facade::primary_graph;

use super::Admission;
use crate::application::{
    CapabilityCandidateReplayIdentifier, CapabilityIdentifier, CapabilityRevision,
    CapabilityStatus, InterfaceCompilerSchema, RecordReplacementVerification,
    ReplayCapabilityIdentifier, ReplayCreatedAt, ReplayIdentifier, ReplayRevision, ReplayStatus,
    ReplayVerificationJson,
};
use crate::host::replay_recovery::{
    denied, stale,
    verification_contract::{conflicts_with_retained_run, ordered},
    InterfaceCompilerReplacementVerification, InterfaceCompilerReplayRecoveryEntity,
    InterfaceCompilerReplayRecoveryOutcome, InterfaceCompilerReplayRecoveryStage,
    RecordReplacementVerificationRequest, MAX_RECOVERY_JSON_BYTES,
    REQUIRED_REPLACEMENT_VERIFICATION_RUNS,
};
use crate::host::InterfaceCompilerWorthHost;

type Projection = primary_graph::WorthQueryApplicationOperationInvariantProjectionSnapshot<
    InterfaceCompilerSchema,
    RecordReplacementVerification,
>;

pub(super) struct VerificationAdmission {
    pub(super) projection: Projection,
    pub(super) next_replay_revision: u64,
    pub(super) retained_json: String,
}

struct VerificationDecision {
    capability_id: Option<String>,
    capability_revision: Option<u64>,
    capability_status: Option<String>,
    capability_candidate: Option<String>,
    replay_id: Option<String>,
    replay_revision: Option<u64>,
    replay_capability: Option<String>,
    replay_status: Option<String>,
    replay_created_at: Option<String>,
    verification_json: Option<String>,
}

pub(super) fn admit_verification(
    host: &InterfaceCompilerWorthHost,
    request: &RecordReplacementVerificationRequest,
    admission: &Admission,
) -> Result<VerificationAdmission, InterfaceCompilerReplayRecoveryOutcome> {
    let (decision, projection, _) = host
        .invariant
        .project_admitted_operation(admission, |reader, replay| {
            let capability = reader
                .resolve_entity(
                    CapabilityIdentifier::reference(),
                    request.capability_id.clone(),
                )
                .expect("the admitted verification can resolve its capability");
            VerificationDecision {
                capability_id: reader
                    .decision_field(&capability, CapabilityIdentifier::reference())
                    .ok()
                    .flatten(),
                capability_revision: reader
                    .decision_field(&capability, CapabilityRevision::reference())
                    .ok()
                    .flatten(),
                capability_status: reader
                    .decision_field(&capability, CapabilityStatus::reference())
                    .ok()
                    .flatten(),
                capability_candidate: reader
                    .decision_field(
                        &capability,
                        CapabilityCandidateReplayIdentifier::reference(),
                    )
                    .ok()
                    .flatten(),
                replay_id: reader
                    .decision_field(replay, ReplayIdentifier::reference())
                    .ok()
                    .flatten(),
                replay_revision: reader
                    .decision_field(replay, ReplayRevision::reference())
                    .ok()
                    .flatten(),
                replay_capability: reader
                    .decision_field(replay, ReplayCapabilityIdentifier::reference())
                    .ok()
                    .flatten(),
                replay_status: reader
                    .decision_field(replay, ReplayStatus::reference())
                    .ok()
                    .flatten(),
                replay_created_at: reader
                    .decision_field(replay, ReplayCreatedAt::reference())
                    .ok()
                    .flatten(),
                verification_json: reader
                    .decision_field(replay, ReplayVerificationJson::reference())
                    .ok()
                    .flatten(),
            }
        })
        .map_err(|error| {
            denied(
                InterfaceCompilerReplayRecoveryStage::DependencyProjection,
                format!("verification decision projection denied: {error:?}"),
            )
        })?
        .into_parts();

    decision.validate_expected_revisions(request)?;
    if !decision.matches_candidate(request) {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "the verification receipt does not belong to the current candidate",
        ));
    }
    let created_at = decision.replay_created_at.as_deref().ok_or_else(|| {
        denied(
            InterfaceCompilerReplayRecoveryStage::DependencyProjection,
            "candidate creation time is absent",
        )
    })?;
    if !ordered(created_at, &request.run.completed_at) {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "verification completion precedes candidate creation",
        ));
    }
    let mut verification = decision
        .verification_json
        .as_deref()
        .and_then(|value| {
            serde_json::from_str::<InterfaceCompilerReplacementVerification>(value).ok()
        })
        .filter(|value| value.required_successful_runs == REQUIRED_REPLACEMENT_VERIFICATION_RUNS)
        .ok_or_else(|| {
            denied(
                InterfaceCompilerReplayRecoveryStage::DependencyProjection,
                "the candidate verification state is malformed",
            )
        })?;
    if conflicts_with_retained_run(&verification, &request.run) {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "verification run, session, or evidence identity was already retained",
        ));
    }
    verification.runs.push(request.run.clone());
    let retained_json =
        serde_json::to_string(&verification).expect("validated verification state serializes");
    if retained_json.len() > MAX_RECOVERY_JSON_BYTES {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "the retained verification evidence exceeds the recovery projection bound",
        ));
    }
    let next_replay_revision = decision
        .replay_revision
        .and_then(|revision| revision.checked_add(1))
        .ok_or_else(|| {
            denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                "replay revision exhausted",
            )
        })?;
    Ok(VerificationAdmission {
        projection,
        next_replay_revision,
        retained_json,
    })
}

impl VerificationDecision {
    fn validate_expected_revisions(
        &self,
        request: &RecordReplacementVerificationRequest,
    ) -> Result<(), InterfaceCompilerReplayRecoveryOutcome> {
        for (entity, id, expected, actual) in [
            (
                InterfaceCompilerReplayRecoveryEntity::Capability,
                request.capability_id.as_str(),
                request.expected_capability_revision,
                self.capability_revision.unwrap_or(u64::MAX),
            ),
            (
                InterfaceCompilerReplayRecoveryEntity::Replay,
                request.replay_version_id.as_str(),
                request.expected_replay_revision,
                self.replay_revision.unwrap_or(u64::MAX),
            ),
        ] {
            if expected != actual {
                return Err(stale(entity, id.to_string(), expected, actual));
            }
        }
        Ok(())
    }

    fn matches_candidate(&self, request: &RecordReplacementVerificationRequest) -> bool {
        self.capability_id.as_deref() == Some(request.capability_id.as_str())
            && self.capability_status.as_deref() == Some("verifying")
            && self.capability_candidate.as_deref() == Some(request.replay_version_id.as_str())
            && self.replay_id.as_deref() == Some(request.replay_version_id.as_str())
            && self.replay_capability.as_deref() == Some(request.capability_id.as_str())
            && self.replay_status.as_deref() == Some("verifying")
            && request.run.capability_id == request.capability_id
            && request.run.replay_version_id == request.replay_version_id
    }
}
