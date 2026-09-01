use super::*;
use crate::host::{
    InterfaceCompilerActiveReplayReadOutcome, InterfaceCompilerCapabilityReadOutcome,
    InterfaceCompilerCompiledReadDenial, InterfaceCompilerCompiledReadRequest,
    InterfaceCompilerWorthHost, DEFAULT_REQUEST_TIMEOUT,
};
use std::time::Duration;

pub(super) fn handle_compiled_plan_read(
    request_id: String,
    request: InterfaceCompilerHostRequest,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerHostResponse {
    let operation = request.operation.clone();
    let Some(capability_id) = request.capability_id else {
        return InterfaceCompilerHostResponse::InvalidRequest {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            reason: InterfaceCompilerHostInvalidRequestReason::MissingCapabilityId,
            message: format!("{operation} requires capability_id"),
        };
    };
    let Some(credential) = request.credential else {
        return InterfaceCompilerHostResponse::InvalidRequest {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            reason: InterfaceCompilerHostInvalidRequestReason::MissingCredential,
            message: format!("{operation} requires credential"),
        };
    };
    let input = InterfaceCompilerCompiledReadRequest::new(
        capability_id,
        credential,
        request
            .deadline_ms
            .map(Duration::from_millis)
            .unwrap_or(DEFAULT_REQUEST_TIMEOUT),
    );
    if operation == READ_CAPABILITY_OPERATION {
        map_capability(request_id, host.read_capability(input))
    } else {
        map_replay(request_id, host.read_active_replay(input))
    }
}

fn map_capability(
    request_id: String,
    outcome: InterfaceCompilerCapabilityReadOutcome,
) -> InterfaceCompilerHostResponse {
    match outcome {
        InterfaceCompilerCapabilityReadOutcome::Found {
            projection,
            evidence,
        } => InterfaceCompilerHostResponse::CapabilityFound {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            operation: READ_CAPABILITY_OPERATION,
            capability: InterfaceCompilerHostCapability {
                projection_kind: "worth_capability",
                id: projection.id,
                revision: projection.revision,
                application_id: projection.application_id,
                name: projection.name,
                description: projection.description,
                status: projection.status,
                active_replay_version_id: projection.active_replay_id,
            },
            evidence: map_evidence(evidence),
        },
        InterfaceCompilerCapabilityReadOutcome::NotFound { capability_id } => {
            InterfaceCompilerHostResponse::CompiledReadNotFound {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation: READ_CAPABILITY_OPERATION,
                capability_id,
            }
        }
        InterfaceCompilerCapabilityReadOutcome::Denied {
            capability_id,
            denial,
        } => denied(request_id, READ_CAPABILITY_OPERATION, capability_id, denial),
    }
}

fn map_replay(
    request_id: String,
    outcome: InterfaceCompilerActiveReplayReadOutcome,
) -> InterfaceCompilerHostResponse {
    match outcome {
        InterfaceCompilerActiveReplayReadOutcome::Found {
            projection,
            evidence,
        } => {
            let steps: Vec<InterfaceCompilerHostReplayStep> =
                match serde_json::from_str(&projection.steps_json) {
                    Ok(value) => value,
                    Err(error) => {
                        return projection_denied(
                            request_id,
                            READ_ACTIVE_REPLAY_OPERATION,
                            projection.capability_id,
                            error,
                        )
                    }
                };
            let verification: InterfaceCompilerHostReplayVerification =
                match serde_json::from_str(&projection.verification_json) {
                    Ok(value) => value,
                    Err(error) => {
                        return projection_denied(
                            request_id,
                            READ_ACTIVE_REPLAY_OPERATION,
                            projection.capability_id,
                            error,
                        )
                    }
                };
            if let Err(message) = validate_replay_payload(
                &projection.id,
                &projection.capability_id,
                &steps,
                &verification,
            ) {
                return denied(
                    request_id,
                    READ_ACTIVE_REPLAY_OPERATION,
                    projection.capability_id,
                    InterfaceCompilerCompiledReadDenial::Projection(message),
                );
            }
            InterfaceCompilerHostResponse::ActiveReplayFound {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation: READ_ACTIVE_REPLAY_OPERATION,
                replay: InterfaceCompilerHostActiveReplay {
                    projection_kind: "worth_replay",
                    id: projection.id,
                    revision: projection.revision,
                    capability_id: projection.capability_id,
                    version: projection.version,
                    steps,
                    confidence: projection.confidence_millis as f64 / 1000.0,
                    status: projection.status,
                    created_at: projection.created_at,
                    verified_at: projection.verified_at,
                    verification,
                },
                evidence: map_evidence(evidence),
            }
        }
        InterfaceCompilerActiveReplayReadOutcome::NotFound { capability_id } => {
            InterfaceCompilerHostResponse::CompiledReadNotFound {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation: READ_ACTIVE_REPLAY_OPERATION,
                capability_id,
            }
        }
        InterfaceCompilerActiveReplayReadOutcome::Denied {
            capability_id,
            denial,
        } => denied(
            request_id,
            READ_ACTIVE_REPLAY_OPERATION,
            capability_id,
            denial,
        ),
    }
}

fn validate_replay_payload(
    replay_id: &str,
    capability_id: &str,
    steps: &[InterfaceCompilerHostReplayStep],
    verification: &InterfaceCompilerHostReplayVerification,
) -> Result<(), String> {
    if steps.is_empty() {
        return Err("active replay steps must not be empty".to_string());
    }
    for step in steps {
        match step {
            InterfaceCompilerHostReplayStep::Navigate { url } if url.trim().is_empty() => {
                return Err("navigate URL must not be empty".to_string())
            }
            InterfaceCompilerHostReplayStep::Click { target }
            | InterfaceCompilerHostReplayStep::Fill { target, .. }
            | InterfaceCompilerHostReplayStep::Select { target, .. }
            | InterfaceCompilerHostReplayStep::Read { target, .. }
                if target.semantic_description.trim().is_empty() =>
            {
                return Err("locator semantic description must not be empty".to_string())
            }
            InterfaceCompilerHostReplayStep::Wait { milliseconds: 0 } => {
                return Err("wait duration must be positive".to_string())
            }
            InterfaceCompilerHostReplayStep::Read { output_key, .. }
                if output_key.trim().is_empty() =>
            {
                return Err("read output key must not be empty".to_string())
            }
            InterfaceCompilerHostReplayStep::Assert { condition } if !condition.is_object() => {
                return Err("assert condition must be an object".to_string())
            }
            _ => {}
        }
    }
    if verification.required_successful_runs == 0 || verification.runs.is_empty() {
        return Err("active replay verification must retain required runs".to_string());
    }
    let successful = verification
        .runs
        .iter()
        .filter(|run| run.outcome == "success")
        .count() as u64;
    if successful < verification.required_successful_runs {
        return Err("active replay verification threshold is not satisfied".to_string());
    }
    for run in &verification.runs {
        if run.id.trim().is_empty()
            || run.session_id.trim().is_empty()
            || !run.fresh_session
            || run.evidence_ids.is_empty()
            || run.completed_at.trim().is_empty()
            || run.capability_id != capability_id
            || run.replay_version_id != replay_id
            || run.outcome != "success"
        {
            return Err(
                "active replay verification run identity or outcome is invalid".to_string(),
            );
        }
    }
    Ok(())
}

fn denied(
    request_id: String,
    operation: &'static str,
    capability_id: String,
    denial: InterfaceCompilerCompiledReadDenial,
) -> InterfaceCompilerHostResponse {
    let (stage, kind) = match denial {
        InterfaceCompilerCompiledReadDenial::InvalidRequest => (
            InterfaceCompilerHostDenialStage::Request,
            "invalid_request".to_string(),
        ),
        InterfaceCompilerCompiledReadDenial::Authentication(kind) => {
            (InterfaceCompilerHostDenialStage::Authentication, kind)
        }
        InterfaceCompilerCompiledReadDenial::PrincipalResolution(kind) => {
            (InterfaceCompilerHostDenialStage::PrincipalResolution, kind)
        }
        InterfaceCompilerCompiledReadDenial::EntityResolution(kind) => {
            (InterfaceCompilerHostDenialStage::EntityResolution, kind)
        }
        InterfaceCompilerCompiledReadDenial::QueryNotInstalled => (
            InterfaceCompilerHostDenialStage::Query,
            "query_not_installed".to_string(),
        ),
        InterfaceCompilerCompiledReadDenial::QueryAdmission(kind)
        | InterfaceCompilerCompiledReadDenial::QueryExecution(kind) => {
            (InterfaceCompilerHostDenialStage::Query, kind)
        }
        InterfaceCompilerCompiledReadDenial::Projection(kind) => {
            (InterfaceCompilerHostDenialStage::Projection, kind)
        }
    };
    InterfaceCompilerHostResponse::CompiledReadDenied {
        protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
        request_id,
        operation,
        capability_id,
        stage,
        message: kind.clone(),
        kind,
    }
}
fn projection_denied(
    request_id: String,
    operation: &'static str,
    capability_id: String,
    error: serde_json::Error,
) -> InterfaceCompilerHostResponse {
    denied(
        request_id,
        operation,
        capability_id,
        InterfaceCompilerCompiledReadDenial::Projection(error.to_string()),
    )
}
fn map_evidence(
    value: crate::host::InterfaceCompilerApplicationReadEvidence,
) -> InterfaceCompilerHostQueryEvidence {
    InterfaceCompilerHostQueryEvidence {
        query_name: value.query_name,
        query_identity: value.query_identity,
        basis_version: value.basis_version,
        projected_record_count: value.projected_record_count,
        projected_field_count: value.projected_field_count,
        basis_released: value.basis_released,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_payload_rejects_foreign_verification_lineage_and_invalid_steps() {
        let verification = InterfaceCompilerHostReplayVerification {
            required_successful_runs: 1,
            runs: vec![InterfaceCompilerHostVerificationRun {
                id: "run-1".to_string(),
                capability_id: "capability.foreign".to_string(),
                replay_version_id: "replay.expected".to_string(),
                session_id: "session-1".to_string(),
                fresh_session: true,
                outcome: "success".to_string(),
                evidence_ids: vec!["evidence-1".to_string()],
                completed_at: "2026-08-31T18:00:00.000Z".to_string(),
            }],
        };
        assert!(validate_replay_payload(
            "replay.expected",
            "capability.expected",
            &[InterfaceCompilerHostReplayStep::Wait { milliseconds: 1 }],
            &verification
        )
        .is_err());
        let empty_steps = InterfaceCompilerHostReplayVerification {
            runs: vec![],
            ..verification
        };
        assert!(validate_replay_payload(
            "replay.expected",
            "capability.expected",
            &[],
            &empty_steps
        )
        .is_err());
    }
}
