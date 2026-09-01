use worth_query_host::facade::primary_graph;

use super::{decision::DegradationAdmission, Admission};
use crate::application::{
    Capability, CapabilityBrokenReplayIdentifier, CapabilityFailureJson, CapabilityRevision,
    CapabilityStatus, InterfaceCompilerSchema, Replay, ReplayBrokenAt, ReplayFailureJson,
    ReplayRevision, ReplayStatus,
};
use crate::host::replay_recovery::{
    denied, recovery_binding, DegradeReplayRequest, InterfaceCompilerReplayRecoveryOutcome,
    InterfaceCompilerReplayRecoveryStage,
};
use crate::host::InterfaceCompilerWorthHost;

type CapabilityIdentity =
    primary_graph::WorthQueryApplicationEntityIdentity<InterfaceCompilerSchema, Capability>;
type ReplayIdentity =
    primary_graph::WorthQueryApplicationEntityIdentity<InterfaceCompilerSchema, Replay>;

pub(super) fn commit_degradation(
    host: &InterfaceCompilerWorthHost,
    request: &DegradeReplayRequest,
    capability: &CapabilityIdentity,
    replay: &ReplayIdentity,
    admission: Admission,
    admitted: DegradationAdmission,
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
                format!("WORTH recovery dependencies were not current: {error:?}"),
            )
        }
    };
    let mut effects = dependencies.begin_effect_program();
    let capability_target = match effects.existing_entity(capability) {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("capability effect target denied: {error:?}"),
            )
        }
    };
    let replay_target = match effects.existing_entity(replay) {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("replay effect target denied: {error:?}"),
            )
        }
    };
    let writes = effects
        .write_field(
            &capability_target,
            CapabilityRevision::reference(),
            admitted.next_capability_revision,
        )
        .and_then(|_| {
            effects.write_field(
                &capability_target,
                CapabilityStatus::reference(),
                "degraded".to_string(),
            )
        })
        .and_then(|_| {
            effects.write_optional_field(
                &capability_target,
                CapabilityBrokenReplayIdentifier::reference(),
                Some(request.replay_version_id.clone()),
            )
        })
        .and_then(|_| {
            effects.write_optional_field(
                &capability_target,
                CapabilityFailureJson::reference(),
                Some(admitted.failure_json.clone()),
            )
        })
        .and_then(|_| {
            effects.write_field(
                &replay_target,
                ReplayRevision::reference(),
                admitted.next_replay_revision,
            )
        })
        .and_then(|_| {
            effects.write_field(
                &replay_target,
                ReplayStatus::reference(),
                "broken".to_string(),
            )
        })
        .and_then(|_| {
            effects.write_optional_field(
                &replay_target,
                ReplayFailureJson::reference(),
                Some(admitted.failure_json.clone()),
            )
        })
        .and_then(|_| {
            effects.write_optional_field(
                &replay_target,
                ReplayBrokenAt::reference(),
                Some(admitted.broken_at.clone()),
            )
        });
    if let Err(error) = writes {
        return denied(
            InterfaceCompilerReplayRecoveryStage::EffectProgram,
            format!("WORTH denied degradation effects: {error:?}"),
        );
    }
    let program = match effects.finish() {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("WORTH denied the degradation program: {error:?}"),
            )
        }
    };
    let commit = match host.settle_recovery_commit(host.application.compare_and_commit_application(
        program,
        recovery_binding(
            b"degrade-replay",
            &request.execution_id,
            &request.replay_version_id,
            admitted.failure_json.as_bytes(),
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
