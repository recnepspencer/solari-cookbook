//! Wire mapping for WORTH-owned replay recovery operations.

use std::time::Duration;

use super::*;
use crate::host::{
    AcceptReplacementCandidateRequest, ActivateReplacementRequest, DegradeReplayRequest,
    InterfaceCompilerExecutionCommitKind, InterfaceCompilerReplacementCandidate,
    InterfaceCompilerReplacementVerificationRun, InterfaceCompilerReplayRecoveryOutcome,
    InterfaceCompilerReplayRecoveryStage, InterfaceCompilerVerificationEvidence,
    InterfaceCompilerWorthHost, RecordReplacementVerificationRequest,
    RegisterVerificationEvidenceRequest, DEFAULT_REQUEST_TIMEOUT,
};

pub(super) fn handle_replay_recovery(
    request_id: String,
    request: InterfaceCompilerHostRequest,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerHostResponse {
    let operation =
        operation_name(&request.operation).expect("recovery routing checked the operation");
    let Some(credential) = request.credential.clone() else {
        return request_denied(
            request_id,
            operation,
            "the recovery request requires credential",
        );
    };
    let timeout = request
        .deadline_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_REQUEST_TIMEOUT);
    let outcome = match operation {
        DEGRADE_REPLAY_OPERATION => degrade(request, credential, timeout, host),
        ACCEPT_REPLACEMENT_CANDIDATE_OPERATION => {
            accept_candidate(request, credential, timeout, host)
        }
        REGISTER_VERIFICATION_EVIDENCE_OPERATION => {
            register_evidence(request, credential, timeout, host)
        }
        RECORD_REPLACEMENT_VERIFICATION_OPERATION => {
            record_verification(request, credential, timeout, host)
        }
        ACTIVATE_REPLACEMENT_OPERATION => activate(request, credential, timeout, host),
        _ => unreachable!("operation_name admits only recovery operations"),
    };
    map_outcome(request_id, operation, outcome)
}

fn register_evidence(
    request: InterfaceCompilerHostRequest,
    credential: String,
    timeout: Duration,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerReplayRecoveryOutcome {
    let Some(capability_id) = request.capability_id else {
        return malformed("register_verification_evidence requires capability_id");
    };
    let Some(replay_version_id) = request.replay_version_id else {
        return malformed("register_verification_evidence requires replay_version_id");
    };
    let Some(expected_capability_revision) = request.expected_capability_revision else {
        return malformed("register_verification_evidence requires expected_capability_revision");
    };
    let Some(expected_replay_revision) = request.expected_replay_revision else {
        return malformed("register_verification_evidence requires expected_replay_revision");
    };
    let Some(evidence) = request.verification_evidence.and_then(|value| {
        serde_json::from_value::<InterfaceCompilerVerificationEvidence>(value).ok()
    }) else {
        return malformed("register_verification_evidence requires valid verification_evidence");
    };
    host.register_verification_evidence(RegisterVerificationEvidenceRequest {
        capability_id,
        replay_version_id,
        expected_capability_revision,
        expected_replay_revision,
        evidence,
        credential,
        timeout,
    })
}

fn degrade(
    request: InterfaceCompilerHostRequest,
    credential: String,
    timeout: Duration,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerReplayRecoveryOutcome {
    let Some(execution_id) = request.execution_id else {
        return malformed("degrade_replay requires execution_id");
    };
    let Some(capability_id) = request.capability_id else {
        return malformed("degrade_replay requires capability_id");
    };
    let Some(replay_version_id) = request.replay_version_id else {
        return malformed("degrade_replay requires replay_version_id");
    };
    let Some(expected_execution_revision) = request.expected_execution_revision else {
        return malformed("degrade_replay requires expected_execution_revision");
    };
    let Some(expected_capability_revision) = request.expected_capability_revision else {
        return malformed("degrade_replay requires expected_capability_revision");
    };
    let Some(expected_replay_revision) = request.expected_replay_revision else {
        return malformed("degrade_replay requires expected_replay_revision");
    };
    host.degrade_replay(DegradeReplayRequest {
        execution_id,
        capability_id,
        replay_version_id,
        expected_execution_revision,
        expected_capability_revision,
        expected_replay_revision,
        credential,
        timeout,
    })
}

fn accept_candidate(
    request: InterfaceCompilerHostRequest,
    credential: String,
    timeout: Duration,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerReplayRecoveryOutcome {
    let Some(capability_id) = request.capability_id else {
        return malformed("accept_replacement_candidate requires capability_id");
    };
    let Some(broken_replay_version_id) = request.broken_replay_version_id else {
        return malformed("accept_replacement_candidate requires broken_replay_version_id");
    };
    let Some(expected_capability_revision) = request.expected_capability_revision else {
        return malformed("accept_replacement_candidate requires expected_capability_revision");
    };
    let Some(expected_broken_replay_revision) = request.expected_broken_replay_revision else {
        return malformed("accept_replacement_candidate requires expected_broken_replay_revision");
    };
    let Some(candidate) = request.candidate.and_then(|value| {
        serde_json::from_value::<InterfaceCompilerReplacementCandidate>(value).ok()
    }) else {
        return malformed("accept_replacement_candidate requires a valid candidate");
    };
    host.accept_replacement_candidate(AcceptReplacementCandidateRequest {
        capability_id,
        broken_replay_version_id,
        expected_capability_revision,
        expected_broken_replay_revision,
        candidate,
        credential,
        timeout,
    })
}

fn record_verification(
    request: InterfaceCompilerHostRequest,
    credential: String,
    timeout: Duration,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerReplayRecoveryOutcome {
    let Some(capability_id) = request.capability_id else {
        return malformed("record_replacement_verification requires capability_id");
    };
    let Some(replay_version_id) = request.replay_version_id else {
        return malformed("record_replacement_verification requires replay_version_id");
    };
    let Some(expected_capability_revision) = request.expected_capability_revision else {
        return malformed("record_replacement_verification requires expected_capability_revision");
    };
    let Some(expected_replay_revision) = request.expected_replay_revision else {
        return malformed("record_replacement_verification requires expected_replay_revision");
    };
    let Some(run) = request.verification_run.and_then(|value| {
        serde_json::from_value::<InterfaceCompilerReplacementVerificationRun>(value).ok()
    }) else {
        return malformed("record_replacement_verification requires a valid verification_run");
    };
    host.record_replacement_verification(RecordReplacementVerificationRequest {
        capability_id,
        replay_version_id,
        expected_capability_revision,
        expected_replay_revision,
        run,
        credential,
        timeout,
    })
}

fn activate(
    request: InterfaceCompilerHostRequest,
    credential: String,
    timeout: Duration,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerReplayRecoveryOutcome {
    let Some(capability_id) = request.capability_id else {
        return malformed("activate_replacement requires capability_id");
    };
    let Some(replay_version_id) = request.replay_version_id else {
        return malformed("activate_replacement requires replay_version_id");
    };
    let Some(expected_capability_revision) = request.expected_capability_revision else {
        return malformed("activate_replacement requires expected_capability_revision");
    };
    let Some(expected_replay_revision) = request.expected_replay_revision else {
        return malformed("activate_replacement requires expected_replay_revision");
    };
    let Some(verified_at) = request.verified_at else {
        return malformed("activate_replacement requires verified_at");
    };
    host.activate_replacement(ActivateReplacementRequest {
        capability_id,
        replay_version_id,
        expected_capability_revision,
        expected_replay_revision,
        verified_at,
        credential,
        timeout,
    })
}

fn map_outcome(
    request_id: String,
    operation: &'static str,
    outcome: InterfaceCompilerReplayRecoveryOutcome,
) -> InterfaceCompilerHostResponse {
    match outcome {
        InterfaceCompilerReplayRecoveryOutcome::Applied {
            commit,
            capability,
            capability_evidence,
            replay,
            replay_evidence,
        } => {
            let capability = match super::compiled_plan_read::map_capability_projection(capability)
            {
                Ok(value) => value,
                Err(message) => {
                    return committed_projection_unavailable(request_id, operation, commit, message)
                }
            };
            let replay = match super::compiled_plan_read::map_replay_projection(replay) {
                Ok(value) => value,
                Err(message) => {
                    return committed_projection_unavailable(request_id, operation, commit, message)
                }
            };
            InterfaceCompilerHostResponse::ReplayRecoveryApplied {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation,
                commit: map_commit(commit),
                capability,
                replay,
                capability_evidence: super::compiled_plan_read::map_evidence(capability_evidence),
                replay_evidence: super::compiled_plan_read::map_evidence(replay_evidence),
            }
        }
        InterfaceCompilerReplayRecoveryOutcome::Stale {
            entity,
            entity_id,
            expected,
            actual,
        } => InterfaceCompilerHostResponse::ReplayRecoveryStale {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            operation,
            entity,
            entity_id,
            expected_revision: expected,
            actual_revision: actual,
        },
        InterfaceCompilerReplayRecoveryOutcome::Denied { stage, detail } => {
            response_denied(request_id, operation, stage, detail)
        }
        InterfaceCompilerReplayRecoveryOutcome::Stopped { reason, detail } => {
            InterfaceCompilerHostResponse::ReplayRecoveryStopped {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation,
                reason,
                message: detail,
            }
        }
        InterfaceCompilerReplayRecoveryOutcome::CommittedProjectionUnavailable {
            commit,
            detail,
        } => committed_projection_unavailable(request_id, operation, commit, detail),
    }
}

fn committed_projection_unavailable(
    request_id: String,
    operation: &'static str,
    commit: InterfaceCompilerExecutionCommitKind,
    message: impl Into<String>,
) -> InterfaceCompilerHostResponse {
    InterfaceCompilerHostResponse::ReplayRecoveryCommittedProjectionUnavailable {
        protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
        request_id,
        operation,
        commit: map_commit(commit),
        message: message.into(),
    }
}

fn malformed(message: impl Into<String>) -> InterfaceCompilerReplayRecoveryOutcome {
    InterfaceCompilerReplayRecoveryOutcome::Denied {
        stage: InterfaceCompilerReplayRecoveryStage::Request,
        detail: message.into(),
    }
}

fn request_denied(
    request_id: String,
    operation: &'static str,
    message: impl Into<String>,
) -> InterfaceCompilerHostResponse {
    response_denied(
        request_id,
        operation,
        InterfaceCompilerReplayRecoveryStage::Request,
        message,
    )
}

fn response_denied(
    request_id: String,
    operation: &'static str,
    stage: InterfaceCompilerReplayRecoveryStage,
    message: impl Into<String>,
) -> InterfaceCompilerHostResponse {
    InterfaceCompilerHostResponse::ReplayRecoveryDenied {
        protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
        request_id,
        operation,
        stage,
        message: message.into(),
    }
}

fn operation_name(value: &str) -> Option<&'static str> {
    match value {
        DEGRADE_REPLAY_OPERATION => Some(DEGRADE_REPLAY_OPERATION),
        ACCEPT_REPLACEMENT_CANDIDATE_OPERATION => Some(ACCEPT_REPLACEMENT_CANDIDATE_OPERATION),
        REGISTER_VERIFICATION_EVIDENCE_OPERATION => Some(REGISTER_VERIFICATION_EVIDENCE_OPERATION),
        RECORD_REPLACEMENT_VERIFICATION_OPERATION => {
            Some(RECORD_REPLACEMENT_VERIFICATION_OPERATION)
        }
        ACTIVATE_REPLACEMENT_OPERATION => Some(ACTIVATE_REPLACEMENT_OPERATION),
        _ => None,
    }
}

fn map_commit(value: InterfaceCompilerExecutionCommitKind) -> InterfaceCompilerHostCommitKind {
    match value {
        InterfaceCompilerExecutionCommitKind::Committed => {
            InterfaceCompilerHostCommitKind::Committed
        }
        InterfaceCompilerExecutionCommitKind::AlreadyCommitted => {
            InterfaceCompilerHostCommitKind::AlreadyCommitted
        }
    }
}
