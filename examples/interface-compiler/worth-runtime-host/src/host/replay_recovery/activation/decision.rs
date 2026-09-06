use worth_query_host::facade::primary_graph;

use super::Admission;
use crate::application::{
    ActivateReplacement, CapabilityActiveReplayIdentifier, CapabilityBrokenReplayIdentifier,
    CapabilityCandidateReplayIdentifier, CapabilityFailureJson, CapabilityIdentifier,
    CapabilityRevision, CapabilityStatus, InterfaceCompilerSchema, ReplayCapabilityIdentifier,
    ReplayCreatedAt, ReplayIdentifier, ReplayRevision, ReplayStatus, ReplaySupersedesIdentifier,
    ReplayVerificationJson, ReplayVerifiedAt,
};
use crate::host::replay_recovery::{
    denied, stale, validation::verification_admits_activation, ActivateReplacementRequest,
    InterfaceCompilerReplacementVerification, InterfaceCompilerReplayRecoveryEntity,
    InterfaceCompilerReplayRecoveryOutcome, InterfaceCompilerReplayRecoveryStage,
};
use crate::host::InterfaceCompilerWorthHost;

type Projection = primary_graph::WorthQueryApplicationOperationInvariantProjectionSnapshot<
    InterfaceCompilerSchema,
    ActivateReplacement,
>;

pub(super) struct ActivationAdmission {
    pub(super) projection: Projection,
    pub(super) next_capability_revision: u64,
    pub(super) next_replay_revision: u64,
}

struct ActivationDecision {
    capability_id: Option<String>,
    capability_revision: Option<u64>,
    capability_status: Option<String>,
    active_replay: Option<String>,
    candidate_replay: Option<String>,
    broken_replay: Option<String>,
    capability_failure: Option<String>,
    replay_id: Option<String>,
    replay_revision: Option<u64>,
    replay_capability: Option<String>,
    replay_status: Option<String>,
    replay_created_at: Option<String>,
    replay_supersedes: Option<String>,
    verification_json: Option<String>,
    replay_verified_at: Option<String>,
}

pub(super) fn admit_activation(
    host: &InterfaceCompilerWorthHost,
    request: &ActivateReplacementRequest,
    admission: &Admission,
) -> Result<ActivationAdmission, InterfaceCompilerReplayRecoveryOutcome> {
    let (decision, projection, _) = host
        .invariant
        .project_admitted_operation(admission, |reader, capability| {
            let replay = reader
                .resolve_entity(
                    ReplayIdentifier::reference(),
                    request.replay_version_id.clone(),
                )
                .expect("the admitted activation can resolve its candidate replay");
            ActivationDecision {
                capability_id: reader
                    .decision_field(capability, CapabilityIdentifier::reference())
                    .ok()
                    .flatten(),
                capability_revision: reader
                    .decision_field(capability, CapabilityRevision::reference())
                    .ok()
                    .flatten(),
                capability_status: reader
                    .decision_field(capability, CapabilityStatus::reference())
                    .ok()
                    .flatten(),
                active_replay: reader
                    .decision_field(capability, CapabilityActiveReplayIdentifier::reference())
                    .ok()
                    .flatten(),
                candidate_replay: reader
                    .decision_field(capability, CapabilityCandidateReplayIdentifier::reference())
                    .ok()
                    .flatten(),
                broken_replay: reader
                    .decision_field(capability, CapabilityBrokenReplayIdentifier::reference())
                    .ok()
                    .flatten(),
                capability_failure: reader
                    .decision_field(capability, CapabilityFailureJson::reference())
                    .ok()
                    .flatten(),
                replay_id: reader
                    .decision_field(&replay, ReplayIdentifier::reference())
                    .ok()
                    .flatten(),
                replay_revision: reader
                    .decision_field(&replay, ReplayRevision::reference())
                    .ok()
                    .flatten(),
                replay_capability: reader
                    .decision_field(&replay, ReplayCapabilityIdentifier::reference())
                    .ok()
                    .flatten(),
                replay_status: reader
                    .decision_field(&replay, ReplayStatus::reference())
                    .ok()
                    .flatten(),
                replay_created_at: reader
                    .decision_field(&replay, ReplayCreatedAt::reference())
                    .ok()
                    .flatten(),
                replay_supersedes: reader
                    .decision_field(&replay, ReplaySupersedesIdentifier::reference())
                    .ok()
                    .flatten(),
                verification_json: reader
                    .decision_field(&replay, ReplayVerificationJson::reference())
                    .ok()
                    .flatten(),
                replay_verified_at: reader
                    .decision_field(&replay, ReplayVerifiedAt::reference())
                    .ok()
                    .flatten(),
            }
        })
        .map_err(|error| {
            denied(
                InterfaceCompilerReplayRecoveryStage::DependencyProjection,
                format!("activation decision projection denied: {error:?}"),
            )
        })?
        .into_parts();

    decision.validate_expected_revisions(request)?;
    let broken_replay = decision.broken_replay.as_deref().ok_or_else(|| {
        denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "the verifying capability has no broken predecessor",
        )
    })?;
    if !decision.owns_verifying_lineage(request, broken_replay) {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "the candidate does not own the current verifying capability lineage",
        ));
    }
    let verification = decision
        .verification_json
        .as_deref()
        .and_then(|value| {
            serde_json::from_str::<InterfaceCompilerReplacementVerification>(value).ok()
        })
        .ok_or_else(|| {
            denied(
                InterfaceCompilerReplayRecoveryStage::DependencyProjection,
                "the candidate verification state is malformed",
            )
        })?;
    if !verification_admits_activation(
        &verification,
        &request.capability_id,
        &request.replay_version_id,
        decision.replay_created_at.as_deref(),
        &request.verified_at,
    ) {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "the candidate has not retained three valid fresh-session successes",
        ));
    }
    Ok(ActivationAdmission {
        projection,
        next_capability_revision: checked_next_revision(
            decision.capability_revision,
            "capability revision exhausted",
        )?,
        next_replay_revision: checked_next_revision(
            decision.replay_revision,
            "replay revision exhausted",
        )?,
    })
}

fn checked_next_revision(
    revision: Option<u64>,
    message: &'static str,
) -> Result<u64, InterfaceCompilerReplayRecoveryOutcome> {
    revision
        .and_then(|value| value.checked_add(1))
        .ok_or_else(|| denied(InterfaceCompilerReplayRecoveryStage::EffectProgram, message))
}

impl ActivationDecision {
    fn validate_expected_revisions(
        &self,
        request: &ActivateReplacementRequest,
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

    fn owns_verifying_lineage(
        &self,
        request: &ActivateReplacementRequest,
        broken_replay: &str,
    ) -> bool {
        self.capability_id.as_deref() == Some(request.capability_id.as_str())
            && self.capability_status.as_deref() == Some("verifying")
            && self.candidate_replay.as_deref() == Some(request.replay_version_id.as_str())
            && self
                .active_replay
                .as_deref()
                .is_some_and(|active| active != request.replay_version_id)
            && self.capability_failure.is_some()
            && self.replay_id.as_deref() == Some(request.replay_version_id.as_str())
            && self.replay_capability.as_deref() == Some(request.capability_id.as_str())
            && self.replay_status.as_deref() == Some("verifying")
            && self.replay_supersedes.as_deref() == Some(broken_replay)
            && self.replay_verified_at.is_none()
    }
}
