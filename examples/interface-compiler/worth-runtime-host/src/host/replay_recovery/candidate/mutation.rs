use worth_query_host::facade::primary_graph;

use super::{decision::CandidateAdmission, Admission};
use crate::application::{
    Capability, CapabilityCandidateReplayIdentifier, CapabilityRevision, CapabilityStatus,
    InterfaceCompilerSchema, Replay, ReplayCapabilityIdentifier, ReplayConfidenceMillis,
    ReplayCreatedAt, ReplayDiscoveredFromExperimentIdentifier, ReplayIdentifier, ReplayRevision,
    ReplayStatus, ReplayStepsJson, ReplaySupersedesIdentifier, ReplayVerificationJson,
    ReplayVersion,
};
use crate::host::replay_recovery::{
    denied, recovery_binding, validation::candidate_json, AcceptReplacementCandidateRequest,
    InterfaceCompilerReplacementVerification, InterfaceCompilerReplayRecoveryOutcome,
    InterfaceCompilerReplayRecoveryStage, REQUIRED_REPLACEMENT_VERIFICATION_RUNS,
};
use crate::host::InterfaceCompilerWorthHost;

type CapabilityIdentity =
    primary_graph::WorthQueryApplicationEntityIdentity<InterfaceCompilerSchema, Capability>;

pub(super) fn commit_candidate(
    host: &InterfaceCompilerWorthHost,
    request: &AcceptReplacementCandidateRequest,
    capability: &CapabilityIdentity,
    admission: Admission,
    admitted: CandidateAdmission,
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
                format!("candidate dependencies were not current: {error:?}"),
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
    let candidate_key = match primary_graph::WorthQueryApplicationEntityKey::new(
        &request.candidate.replay_version_id,
    ) {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("candidate key denied: {error:?}"),
            )
        }
    };
    let candidate = match effects.create_entity(Replay::reference(), candidate_key) {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("candidate creation denied: {error:?}"),
            )
        }
    };
    let steps_json =
        serde_json::to_string(&request.candidate.steps).expect("validated replay steps serialize");
    let verification_json = serde_json::to_string(&InterfaceCompilerReplacementVerification {
        required_successful_runs: REQUIRED_REPLACEMENT_VERIFICATION_RUNS,
        evidence: Vec::new(),
        runs: Vec::new(),
    })
    .expect("replacement verification state serializes");
    let confidence_millis = (request.candidate.confidence * 1000.0) as u64;
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
                "verifying".to_string(),
            )
        })
        .and_then(|_| {
            effects.write_optional_field(
                &capability_target,
                CapabilityCandidateReplayIdentifier::reference(),
                Some(request.candidate.replay_version_id.clone()),
            )
        })
        .and_then(|_| {
            effects.initialize_field(
                &candidate,
                ReplayIdentifier::reference(),
                request.candidate.replay_version_id.clone(),
            )
        })
        .and_then(|_| effects.initialize_field(&candidate, ReplayRevision::reference(), 0))
        .and_then(|_| {
            effects.initialize_field(
                &candidate,
                ReplayCapabilityIdentifier::reference(),
                request.capability_id.clone(),
            )
        })
        .and_then(|_| {
            effects.initialize_field(
                &candidate,
                ReplayVersion::reference(),
                request.candidate.version,
            )
        })
        .and_then(|_| {
            effects.initialize_field(&candidate, ReplayStepsJson::reference(), steps_json)
        })
        .and_then(|_| {
            effects.initialize_field(
                &candidate,
                ReplayConfidenceMillis::reference(),
                confidence_millis,
            )
        })
        .and_then(|_| {
            effects.initialize_field(
                &candidate,
                ReplayStatus::reference(),
                "verifying".to_string(),
            )
        })
        .and_then(|_| {
            effects.initialize_field(
                &candidate,
                ReplayCreatedAt::reference(),
                request.candidate.created_at.clone(),
            )
        })
        .and_then(|_| {
            effects.initialize_field(
                &candidate,
                ReplayDiscoveredFromExperimentIdentifier::reference(),
                request.candidate.discovered_from_experiment_id.clone(),
            )
        })
        .and_then(|_| {
            effects.initialize_field(
                &candidate,
                ReplaySupersedesIdentifier::reference(),
                request.broken_replay_version_id.clone(),
            )
        })
        .and_then(|_| {
            effects.initialize_field(
                &candidate,
                ReplayVerificationJson::reference(),
                verification_json,
            )
        });
    if let Err(error) = writes {
        return denied(
            InterfaceCompilerReplayRecoveryStage::EffectProgram,
            format!("candidate effects denied: {error:?}"),
        );
    }
    let program = match effects.finish() {
        Ok(value) => value,
        Err(error) => {
            return denied(
                InterfaceCompilerReplayRecoveryStage::EffectProgram,
                format!("candidate program denied: {error:?}"),
            )
        }
    };
    let serialized_candidate = candidate_json(request);
    let commit = match host.settle_recovery_commit(host.application.compare_and_commit_application(
        program,
        recovery_binding(
            b"accept-replacement",
            &request.candidate.replay_version_id,
            &request.candidate.replay_version_id,
            serialized_candidate.as_bytes(),
        ),
    )) {
        Ok(value) => value,
        Err(outcome) => return outcome,
    };
    host.project_recovery(
        &request.capability_id,
        &request.candidate.replay_version_id,
        &request.credential,
        request.timeout,
        commit,
    )
}
