use worth_query_host::facade::primary_graph;

use super::Admission;
use crate::application::{
    AcceptReplacementCandidate, CapabilityActiveReplayIdentifier, CapabilityBrokenReplayIdentifier,
    CapabilityCandidateReplayIdentifier, CapabilityFailureJson, CapabilityIdentifier,
    CapabilityRevision, CapabilityStatus, InterfaceCompilerSchema, ReplayBrokenAt,
    ReplayCapabilityIdentifier, ReplayIdentifier, ReplayRevision, ReplayStatus, ReplayVersion,
};
use crate::host::replay_recovery::{
    denied, stale, AcceptReplacementCandidateRequest, InterfaceCompilerReplayRecoveryEntity,
    InterfaceCompilerReplayRecoveryOutcome, InterfaceCompilerReplayRecoveryStage,
};
use crate::host::InterfaceCompilerWorthHost;

type Projection = primary_graph::WorthQueryApplicationOperationInvariantProjectionSnapshot<
    InterfaceCompilerSchema,
    AcceptReplacementCandidate,
>;

pub(super) struct CandidateAdmission {
    pub(super) projection: Projection,
    pub(super) next_capability_revision: u64,
}

struct CandidateDecision {
    capability_id: Option<String>,
    capability_revision: Option<u64>,
    capability_status: Option<String>,
    active_replay: Option<String>,
    candidate_replay: Option<String>,
    broken_replay_id: Option<String>,
    capability_failure: Option<String>,
    previous_id: Option<String>,
    previous_revision: Option<u64>,
    previous_capability: Option<String>,
    previous_version: Option<u64>,
    previous_status: Option<String>,
    previous_broken_at: Option<String>,
}

pub(super) fn admit_candidate(
    host: &InterfaceCompilerWorthHost,
    request: &AcceptReplacementCandidateRequest,
    admission: &Admission,
) -> Result<CandidateAdmission, InterfaceCompilerReplayRecoveryOutcome> {
    let (decision, projection, _) = host
        .invariant
        .project_admitted_operation(admission, |reader, capability| {
            let broken_replay = reader
                .resolve_entity(
                    ReplayIdentifier::reference(),
                    request.broken_replay_version_id.clone(),
                )
                .expect("the admitted operation can resolve its broken replay");
            CandidateDecision {
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
                broken_replay_id: reader
                    .decision_field(capability, CapabilityBrokenReplayIdentifier::reference())
                    .ok()
                    .flatten(),
                capability_failure: reader
                    .decision_field(capability, CapabilityFailureJson::reference())
                    .ok()
                    .flatten(),
                previous_id: reader
                    .decision_field(&broken_replay, ReplayIdentifier::reference())
                    .ok()
                    .flatten(),
                previous_revision: reader
                    .decision_field(&broken_replay, ReplayRevision::reference())
                    .ok()
                    .flatten(),
                previous_capability: reader
                    .decision_field(&broken_replay, ReplayCapabilityIdentifier::reference())
                    .ok()
                    .flatten(),
                previous_version: reader
                    .decision_field(&broken_replay, ReplayVersion::reference())
                    .ok()
                    .flatten(),
                previous_status: reader
                    .decision_field(&broken_replay, ReplayStatus::reference())
                    .ok()
                    .flatten(),
                previous_broken_at: reader
                    .decision_field(&broken_replay, ReplayBrokenAt::reference())
                    .ok()
                    .flatten(),
            }
        })
        .map_err(|error| {
            denied(
                InterfaceCompilerReplayRecoveryStage::DependencyProjection,
                format!("candidate decision projection denied: {error:?}"),
            )
        })?
        .into_parts();

    decision.validate_expected_revisions(request)?;
    if !decision.continues_degraded_lineage(request) {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "the candidate does not continue the current degraded replay lineage",
        ));
    }
    let next_capability_revision = decision
        .capability_revision
        .and_then(|revision| revision.checked_add(1))
        .ok_or_else(|| {
            denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                "capability revision exhausted",
            )
        })?;
    Ok(CandidateAdmission {
        projection,
        next_capability_revision,
    })
}

impl CandidateDecision {
    fn validate_expected_revisions(
        &self,
        request: &AcceptReplacementCandidateRequest,
    ) -> Result<(), InterfaceCompilerReplayRecoveryOutcome> {
        let actual_capability_revision = self.capability_revision.unwrap_or(u64::MAX);
        if actual_capability_revision != request.expected_capability_revision {
            return Err(stale(
                InterfaceCompilerReplayRecoveryEntity::Capability,
                request.capability_id.clone(),
                request.expected_capability_revision,
                actual_capability_revision,
            ));
        }
        let actual_replay_revision = self.previous_revision.unwrap_or(u64::MAX);
        if actual_replay_revision != request.expected_broken_replay_revision {
            return Err(stale(
                InterfaceCompilerReplayRecoveryEntity::Replay,
                request.broken_replay_version_id.clone(),
                request.expected_broken_replay_revision,
                actual_replay_revision,
            ));
        }
        Ok(())
    }

    fn continues_degraded_lineage(&self, request: &AcceptReplacementCandidateRequest) -> bool {
        let expected_version = self
            .previous_version
            .and_then(|version| version.checked_add(1));
        let valid_chronology = self
            .previous_broken_at
            .as_deref()
            .and_then(|broken_at| chrono::DateTime::parse_from_rfc3339(broken_at).ok())
            .zip(chrono::DateTime::parse_from_rfc3339(&request.candidate.created_at).ok())
            .is_some_and(|(broken_at, created_at)| created_at >= broken_at);
        self.capability_id.as_deref() == Some(request.capability_id.as_str())
            && self.capability_status.as_deref() == Some("degraded")
            && self.active_replay.is_some()
            && self.candidate_replay.is_none()
            && self.broken_replay_id.as_deref() == Some(request.broken_replay_version_id.as_str())
            && self.capability_failure.is_some()
            && self.previous_id.as_deref() == Some(request.broken_replay_version_id.as_str())
            && self.previous_capability.as_deref() == Some(request.capability_id.as_str())
            && self.previous_status.as_deref() == Some("broken")
            && request.candidate.capability_id == request.capability_id
            && request.candidate.supersedes == request.broken_replay_version_id
            && Some(request.candidate.version) == expected_version
            && valid_chronology
    }
}
