use worth_query_host::facade::primary_graph;

use super::{decision::VerificationAdmission, Admission};
use crate::application::{
    Capability, CapabilityBrokenReplayIdentifier, CapabilityCandidateReplayIdentifier,
    CapabilityFailureJson, CapabilityRevision, CapabilityStatus, InterfaceCompilerSchema, Replay,
    ReplayBrokenAt, ReplayFailureJson, ReplayRevision, ReplayStatus, ReplayVerificationJson,
};
use crate::host::replay_recovery::{
    denied, recovery_binding, InterfaceCompilerReplayRecoveryOutcome,
    InterfaceCompilerReplayRecoveryStage, RecordReplacementVerificationRequest,
};
use crate::host::InterfaceCompilerWorthHost;

type ReplayIdentity =
    primary_graph::WorthQueryApplicationEntityIdentity<InterfaceCompilerSchema, Replay>;
type CapabilityIdentity =
    primary_graph::WorthQueryApplicationEntityIdentity<InterfaceCompilerSchema, Capability>;

pub(super) fn commit_verification(
    host: &InterfaceCompilerWorthHost,
    request: &RecordReplacementVerificationRequest,
    capability: &CapabilityIdentity,
    replay: &ReplayIdentity,
    admission: Admission,
    admitted: VerificationAdmission,
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
                format!("verification dependencies were not current: {error:?}"),
            )
        }
    };
    let mut effects = dependencies.begin_effect_program();
    let replay_target = match effects.existing_entity(replay) {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("verification target denied: {error:?}"),
            )
        }
    };
    let capability_target = match effects.existing_entity(capability) {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("verification capability target denied: {error:?}"),
            )
        }
    };
    let writes = effects
        .write_field(
            &replay_target,
            ReplayRevision::reference(),
            admitted.next_replay_revision,
        )
        .and_then(|_| {
            effects.write_field(
                &replay_target,
                ReplayVerificationJson::reference(),
                admitted.retained_json.clone(),
            )
        });
    let writes = if let Some(failure) = admitted.failure {
        writes
            .and_then(|_| {
                effects.write_field(
                    &capability_target,
                    CapabilityRevision::reference(),
                    failure.next_capability_revision,
                )
            })
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
                    CapabilityCandidateReplayIdentifier::reference(),
                    None,
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
                    Some(failure.failure_json.clone()),
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
                    Some(failure.failure_json),
                )
            })
            .and_then(|_| {
                effects.write_optional_field(
                    &replay_target,
                    ReplayBrokenAt::reference(),
                    Some(request.run.completed_at.clone()),
                )
            })
    } else {
        writes
    };
    if let Err(error) = writes {
        return denied(
            InterfaceCompilerReplayRecoveryStage::EffectProgram,
            format!("verification effects denied: {error:?}"),
        );
    }
    let program = match effects.finish() {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("verification program denied: {error:?}"),
            )
        }
    };
    let run_json =
        serde_json::to_string(&request.run).expect("validated verification run serializes");
    let commit = match host.settle_recovery_commit(host.application.compare_and_commit_application(
        program,
        recovery_binding(
            b"record-verification",
            &request.run.id,
            &request.replay_version_id,
            run_json.as_bytes(),
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
