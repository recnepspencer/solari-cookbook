use worth_query_host::facade::primary_graph;

use super::Admission;
use crate::application::{
    CapabilityActiveReplayIdentifier, CapabilityBrokenReplayIdentifier, CapabilityFailureJson,
    CapabilityIdentifier, CapabilityRevision, CapabilityStatus, DegradeReplay,
    ExecutionCapabilityIdentifier, ExecutionIdentifier, ExecutionLifecycle,
    ExecutionReplayIdentifier, ExecutionRevision, ExecutionSettlementJson, InterfaceCompilerSchema,
    ReplayBrokenAt, ReplayCapabilityIdentifier, ReplayFailureJson, ReplayIdentifier,
    ReplayRevision, ReplayStatus,
};
use crate::host::replay_recovery::{
    denied, stale, validation::replay_failure_from_settlement, DegradeReplayRequest,
    InterfaceCompilerReplayRecoveryEntity, InterfaceCompilerReplayRecoveryOutcome,
    InterfaceCompilerReplayRecoveryStage, MAX_RECOVERY_JSON_BYTES,
};
use crate::host::InterfaceCompilerWorthHost;

type Projection = primary_graph::WorthQueryApplicationOperationInvariantProjectionSnapshot<
    InterfaceCompilerSchema,
    DegradeReplay,
>;

pub(super) struct DegradationAdmission {
    pub(super) projection: Projection,
    pub(super) next_capability_revision: u64,
    pub(super) next_replay_revision: u64,
    pub(super) failure_json: String,
    pub(super) broken_at: String,
}

struct DegradationDecision {
    execution_id: Option<String>,
    execution_lifecycle: Option<String>,
    execution_revision: Option<u64>,
    execution_settlement: Option<String>,
    execution_capability: Option<String>,
    execution_replay: Option<String>,
    capability_id: Option<String>,
    capability_revision: Option<u64>,
    capability_status: Option<String>,
    active_replay: Option<String>,
    broken_replay: Option<String>,
    capability_failure: Option<String>,
    replay_id: Option<String>,
    replay_revision: Option<u64>,
    replay_capability: Option<String>,
    replay_status: Option<String>,
    replay_failure: Option<String>,
    replay_broken_at: Option<String>,
}

pub(super) fn admit_degradation(
    host: &InterfaceCompilerWorthHost,
    request: &DegradeReplayRequest,
    admission: &Admission,
) -> Result<DegradationAdmission, InterfaceCompilerReplayRecoveryOutcome> {
    let (decision, projection, _) = host
        .invariant
        .project_admitted_operation(admission, |reader, capability| {
            let execution = reader
                .resolve_entity(
                    ExecutionIdentifier::reference(),
                    request.execution_id.clone(),
                )
                .expect("the admitted operation can resolve its failed execution");
            let replay = reader
                .resolve_entity(
                    ReplayIdentifier::reference(),
                    request.replay_version_id.clone(),
                )
                .expect("the admitted operation can resolve its active replay");
            DegradationDecision {
                execution_id: reader
                    .decision_field(&execution, ExecutionIdentifier::reference())
                    .ok()
                    .flatten(),
                execution_lifecycle: reader
                    .decision_field(&execution, ExecutionLifecycle::reference())
                    .ok()
                    .flatten(),
                execution_revision: reader
                    .decision_field(&execution, ExecutionRevision::reference())
                    .ok()
                    .flatten(),
                execution_settlement: reader
                    .decision_field(&execution, ExecutionSettlementJson::reference())
                    .ok()
                    .flatten(),
                execution_capability: reader
                    .decision_field(&execution, ExecutionCapabilityIdentifier::reference())
                    .ok()
                    .flatten(),
                execution_replay: reader
                    .decision_field(&execution, ExecutionReplayIdentifier::reference())
                    .ok()
                    .flatten(),
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
                replay_failure: reader
                    .decision_field(&replay, ReplayFailureJson::reference())
                    .ok()
                    .flatten(),
                replay_broken_at: reader
                    .decision_field(&replay, ReplayBrokenAt::reference())
                    .ok()
                    .flatten(),
            }
        })
        .map_err(|error| {
            denied(
                InterfaceCompilerReplayRecoveryStage::DependencyProjection,
                format!("WORTH could not project recovery decision facts: {error:?}"),
            )
        })?
        .into_parts();

    decision.validate_expected_revisions(request)?;
    let (failure, broken_at) = replay_failure_from_settlement(
        decision.execution_settlement.as_deref(),
    )
    .ok_or_else(|| {
        denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "the WORTH execution does not retain a valid replay failure",
        )
    })?;
    if !decision.is_current_healthy_lineage(request) {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "the execution, capability, and replay do not form the current healthy lineage",
        ));
    }
    let failure_json =
        serde_json::to_string(&failure).expect("validated replay failure serializes");
    if failure_json.len() > MAX_RECOVERY_JSON_BYTES {
        return Err(denied(
            InterfaceCompilerReplayRecoveryStage::OperationAdmission,
            "the replay failure exceeds the recovery projection bound",
        ));
    }
    let next_capability_revision = checked_next_revision(
        decision.capability_revision,
        "capability revision exhausted",
    )?;
    let next_replay_revision =
        checked_next_revision(decision.replay_revision, "replay revision exhausted")?;
    Ok(DegradationAdmission {
        projection,
        next_capability_revision,
        next_replay_revision,
        failure_json,
        broken_at,
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

impl DegradationDecision {
    fn validate_expected_revisions(
        &self,
        request: &DegradeReplayRequest,
    ) -> Result<(), InterfaceCompilerReplayRecoveryOutcome> {
        for (entity, id, expected, actual) in [
            (
                InterfaceCompilerReplayRecoveryEntity::Execution,
                request.execution_id.as_str(),
                request.expected_execution_revision,
                self.execution_revision.unwrap_or(u64::MAX),
            ),
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

    fn is_current_healthy_lineage(&self, request: &DegradeReplayRequest) -> bool {
        self.execution_id.as_deref() == Some(request.execution_id.as_str())
            && self.execution_lifecycle.as_deref() == Some("failure")
            && self.execution_capability.as_deref() == Some(request.capability_id.as_str())
            && self.execution_replay.as_deref() == Some(request.replay_version_id.as_str())
            && self.capability_id.as_deref() == Some(request.capability_id.as_str())
            && self.capability_status.as_deref() == Some("healthy")
            && self.active_replay.as_deref() == Some(request.replay_version_id.as_str())
            && self.broken_replay.is_none()
            && self.capability_failure.is_none()
            && self.replay_id.as_deref() == Some(request.replay_version_id.as_str())
            && self.replay_capability.as_deref() == Some(request.capability_id.as_str())
            && self.replay_status.as_deref() == Some("active")
            && self.replay_failure.is_none()
            && self.replay_broken_at.is_none()
    }
}
