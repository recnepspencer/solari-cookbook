use worth_query_host::facade::primary_graph;

use super::{decision::ActivationAdmission, Admission};
use crate::application::{
    Capability, CapabilityActiveReplayIdentifier, CapabilityBrokenReplayIdentifier,
    CapabilityCandidateReplayIdentifier, CapabilityFailureJson, CapabilityRevision,
    CapabilityStatus, InterfaceCompilerSchema, Replay, ReplayRevision, ReplayStatus,
    ReplayVerifiedAt,
};
use crate::host::replay_recovery::{
    denied, recovery_binding, ActivateReplacementRequest, InterfaceCompilerReplayRecoveryOutcome,
    InterfaceCompilerReplayRecoveryStage,
};
use crate::host::InterfaceCompilerWorthHost;

type CapabilityIdentity =
    primary_graph::WorthQueryApplicationEntityIdentity<InterfaceCompilerSchema, Capability>;
type ReplayIdentity =
    primary_graph::WorthQueryApplicationEntityIdentity<InterfaceCompilerSchema, Replay>;

pub(super) fn commit_activation(
    host: &InterfaceCompilerWorthHost,
    request: &ActivateReplacementRequest,
    capability: &CapabilityIdentity,
    replay: &ReplayIdentity,
    admission: Admission,
    admitted: ActivationAdmission,
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
                format!("activation dependencies were not current: {error:?}"),
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
                "healthy".to_string(),
            )
        })
        .and_then(|_| {
            effects.write_field(
                &capability_target,
                CapabilityActiveReplayIdentifier::reference(),
                request.replay_version_id.clone(),
            )
        })
        .and_then(|_| {
            effects.write_optional_field(
                &capability_target,
                CapabilityCandidateReplayIdentifier::reference(),
                None,
            )
        })
        .and_then(|_| {
            effects.write_optional_field(
                &capability_target,
                CapabilityBrokenReplayIdentifier::reference(),
                None,
            )
        })
        .and_then(|_| {
            effects.write_optional_field(
                &capability_target,
                CapabilityFailureJson::reference(),
                None,
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
                "active".to_string(),
            )
        })
        .and_then(|_| {
            effects.write_optional_field(
                &replay_target,
                ReplayVerifiedAt::reference(),
                Some(request.verified_at.clone()),
            )
        });
    if let Err(error) = writes {
        return denied(
            InterfaceCompilerReplayRecoveryStage::EffectProgram,
            format!("activation effects denied: {error:?}"),
        );
    }
    let program = match effects.finish() {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("activation program denied: {error:?}"),
            )
        }
    };
    let commit = match host.settle_recovery_commit(host.application.compare_and_commit_application(
        program,
        recovery_binding(
            b"activate-replacement",
            &request.capability_id,
            &request.replay_version_id,
            request.verified_at.as_bytes(),
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
