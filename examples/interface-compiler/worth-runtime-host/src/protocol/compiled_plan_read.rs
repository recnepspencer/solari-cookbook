use super::*;
use crate::application::{
    InterfaceCompilerActiveReplayProjection, InterfaceCompilerCapabilityProjection,
};
use crate::host::{
    InterfaceCompilerActiveReplayReadOutcome, InterfaceCompilerCapabilityReadOutcome,
    InterfaceCompilerCompiledReadDenial, InterfaceCompilerCompiledReadRequest,
    InterfaceCompilerRecoveryProjectionReadOutcome, InterfaceCompilerWorthHost,
    DEFAULT_REQUEST_TIMEOUT,
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
    if operation == READ_RECOVERY_PROJECTION_OPERATION {
        map_recovery_projection(request_id, host.read_recovery_projection(input))
    } else if operation == READ_CAPABILITY_OPERATION {
        map_capability(request_id, host.read_capability(input))
    } else {
        map_replay(request_id, host.read_active_replay(input))
    }
}

fn map_recovery_projection(
    request_id: String,
    outcome: InterfaceCompilerRecoveryProjectionReadOutcome,
) -> InterfaceCompilerHostResponse {
    match outcome {
        InterfaceCompilerRecoveryProjectionReadOutcome::Found {
            capability,
            capability_evidence,
            replay,
            replay_evidence,
        } => {
            let capability_id = capability.id.clone();
            let capability = match map_capability_projection(capability) {
                Ok(value) => value,
                Err(message) => {
                    return denied(
                        request_id,
                        READ_RECOVERY_PROJECTION_OPERATION,
                        capability_id,
                        InterfaceCompilerCompiledReadDenial::Projection(message),
                    )
                }
            };
            let replay = match map_replay_projection(replay) {
                Ok(value) => value,
                Err(message) => {
                    return denied(
                        request_id,
                        READ_RECOVERY_PROJECTION_OPERATION,
                        capability_id,
                        InterfaceCompilerCompiledReadDenial::Projection(message),
                    )
                }
            };
            InterfaceCompilerHostResponse::RecoveryProjectionFound {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation: READ_RECOVERY_PROJECTION_OPERATION,
                capability,
                replay,
                capability_evidence: map_evidence(capability_evidence),
                replay_evidence: map_evidence(replay_evidence),
            }
        }
        InterfaceCompilerRecoveryProjectionReadOutcome::NotFound { capability_id } => {
            InterfaceCompilerHostResponse::CompiledReadNotFound {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation: READ_RECOVERY_PROJECTION_OPERATION,
                capability_id,
            }
        }
        InterfaceCompilerRecoveryProjectionReadOutcome::Denied {
            capability_id,
            denial,
        } => denied(
            request_id,
            READ_RECOVERY_PROJECTION_OPERATION,
            capability_id,
            denial,
        ),
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
        } => {
            let capability_id = projection.id.clone();
            let capability = match map_capability_projection(projection) {
                Ok(value) => value,
                Err(message) => {
                    return denied(
                        request_id,
                        READ_CAPABILITY_OPERATION,
                        capability_id,
                        InterfaceCompilerCompiledReadDenial::Projection(message),
                    )
                }
            };
            InterfaceCompilerHostResponse::CapabilityFound {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation: READ_CAPABILITY_OPERATION,
                capability,
                evidence: map_evidence(evidence),
            }
        }
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
            let capability_id = projection.capability_id.clone();
            let replay = match map_replay_projection(projection) {
                Ok(value) => value,
                Err(message) => {
                    return denied(
                        request_id,
                        READ_ACTIVE_REPLAY_OPERATION,
                        capability_id,
                        InterfaceCompilerCompiledReadDenial::Projection(message),
                    )
                }
            };
            InterfaceCompilerHostResponse::ActiveReplayFound {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation: READ_ACTIVE_REPLAY_OPERATION,
                replay,
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

pub(super) fn map_capability_projection(
    projection: InterfaceCompilerCapabilityProjection,
) -> Result<InterfaceCompilerHostCapability, String> {
    let input_schema: serde_json::Value = serde_json::from_str(&projection.input_schema_json)
        .map_err(|error| format!("capability input schema is malformed: {error}"))?;
    let output_schema: serde_json::Value = serde_json::from_str(&projection.output_schema_json)
        .map_err(|error| format!("capability output schema is malformed: {error}"))?;
    let preconditions: serde_json::Value = serde_json::from_str(&projection.preconditions_json)
        .map_err(|error| format!("capability preconditions are malformed: {error}"))?;
    let postconditions: serde_json::Value =
        serde_json::from_str(&projection.postconditions_json)
            .map_err(|error| format!("capability postconditions are malformed: {error}"))?;
    let publication: serde_json::Value = serde_json::from_str(&projection.publication_json)
        .map_err(|error| format!("capability publication contract is malformed: {error}"))?;
    let failure = projection
        .failure_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| format!("capability failure is malformed: {error}"))?;
    let valid = match projection.status.as_str() {
        "healthy" => {
            projection.active_replay_id.is_some()
                && projection.candidate_replay_id.is_none()
                && projection.broken_replay_id.is_none()
                && failure.is_none()
        }
        "degraded" => {
            projection.active_replay_id.is_some()
                && projection.broken_replay_id.is_some()
                && projection.candidate_replay_id.is_none()
                && failure.as_ref().is_some_and(serde_json::Value::is_object)
        }
        "verifying" => {
            projection.active_replay_id.is_some()
                && projection.broken_replay_id.is_some()
                && projection.candidate_replay_id.is_some()
                && failure.as_ref().is_some_and(serde_json::Value::is_object)
        }
        _ => false,
    };
    if !valid {
        return Err("the WORTH capability lifecycle projection is inconsistent".to_string());
    }
    Ok(InterfaceCompilerHostCapability {
        projection_kind: "worth_capability",
        id: projection.id,
        revision: projection.revision,
        application_id: projection.application_id,
        name: projection.name,
        description: projection.description,
        input_schema,
        output_schema,
        preconditions,
        postconditions,
        publication,
        status: projection.status,
        active_replay_version_id: projection.active_replay_id,
        candidate_replay_version_id: projection.candidate_replay_id,
        broken_replay_version_id: projection.broken_replay_id,
        failure,
    })
}

pub(super) fn map_replay_projection(
    projection: InterfaceCompilerActiveReplayProjection,
) -> Result<InterfaceCompilerHostActiveReplay, String> {
    let steps: Vec<InterfaceCompilerHostReplayStep> = serde_json::from_str(&projection.steps_json)
        .map_err(|error| format!("replay steps are malformed: {error}"))?;
    let verification: InterfaceCompilerHostReplayVerification =
        serde_json::from_str(&projection.verification_json)
            .map_err(|error| format!("replay verification is malformed: {error}"))?;
    let failure = projection
        .failure_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| format!("replay failure is malformed: {error}"))?;
    validate_replay_payload(
        &projection.id,
        &projection.capability_id,
        &projection.status,
        &steps,
        &verification,
        projection.verified_at.as_deref(),
        failure.as_ref(),
        projection.broken_at.as_deref(),
    )?;
    Ok(InterfaceCompilerHostActiveReplay {
        projection_kind: "worth_replay",
        id: projection.id,
        revision: projection.revision,
        capability_id: projection.capability_id,
        version: projection.version,
        steps,
        confidence: projection.confidence_millis as f64 / 1000.0,
        status: projection.status,
        created_at: projection.created_at,
        discovered_from_experiment_id: projection.discovered_from_experiment_id,
        supersedes: projection.supersedes_id,
        verified_at: projection.verified_at,
        verification,
        failure,
        broken_at: projection.broken_at,
    })
}

fn validate_replay_payload(
    replay_id: &str,
    capability_id: &str,
    status: &str,
    steps: &[InterfaceCompilerHostReplayStep],
    verification: &InterfaceCompilerHostReplayVerification,
    verified_at: Option<&str>,
    failure: Option<&serde_json::Value>,
    broken_at: Option<&str>,
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
    if verification.required_successful_runs == 0 {
        return Err("replay verification threshold must be positive".to_string());
    }
    let successful = verification
        .runs
        .iter()
        .filter(|run| run.outcome == "success")
        .count() as u64;
    let mut run_ids = std::collections::BTreeSet::new();
    let mut session_ids = std::collections::BTreeSet::new();
    let mut evidence_ids = std::collections::BTreeSet::new();
    for run in &verification.runs {
        if run.id.trim().is_empty()
            || run.session_id.trim().is_empty()
            || !run_ids.insert(run.id.as_str())
            || !session_ids.insert(run.session_id.as_str())
            || !run.fresh_session
            || run.evidence_ids.is_empty()
            || run
                .evidence_ids
                .iter()
                .any(|evidence_id| !evidence_ids.insert(evidence_id.as_str()))
            || run.completed_at.trim().is_empty()
            || run.capability_id != capability_id
            || run.replay_version_id != replay_id
            || !matches!(run.outcome.as_str(), "success" | "failure")
            || (run.outcome == "failure"
                && run.failure_message.as_deref().is_none_or(str::is_empty))
            || (run.outcome == "success" && run.failure_message.is_some())
        {
            return Err(
                "active replay verification run identity or outcome is invalid".to_string(),
            );
        }
    }
    match status {
        "active"
            if verified_at.is_some()
                && failure.is_none()
                && broken_at.is_none()
                && !verification.runs.is_empty()
                && successful >= verification.required_successful_runs =>
        {
            Ok(())
        }
        "verifying" if verified_at.is_none() && failure.is_none() && broken_at.is_none() => Ok(()),
        "broken" if failure.is_some_and(serde_json::Value::is_object) && broken_at.is_some() => {
            Ok(())
        }
        _ => Err("the WORTH replay lifecycle projection is inconsistent".to_string()),
    }?;
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
pub(super) fn map_evidence(
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
            evidence: Vec::new(),
            runs: vec![InterfaceCompilerHostVerificationRun {
                id: "run-1".to_string(),
                capability_id: "capability.foreign".to_string(),
                replay_version_id: "replay.expected".to_string(),
                session_id: "session-1".to_string(),
                fresh_session: true,
                outcome: "success".to_string(),
                failure_message: None,
                evidence_ids: vec!["evidence-1".to_string()],
                completed_at: "2026-08-31T18:00:00.000Z".to_string(),
            }],
        };
        assert!(validate_replay_payload(
            "replay.expected",
            "capability.expected",
            "active",
            &[InterfaceCompilerHostReplayStep::Wait { milliseconds: 1 }],
            &verification,
            Some("2026-08-31T18:01:00.000Z"),
            None,
            None,
        )
        .is_err());

        let duplicate_runs = InterfaceCompilerHostReplayVerification {
            required_successful_runs: 2,
            evidence: Vec::new(),
            runs: vec![
                InterfaceCompilerHostVerificationRun {
                    id: "run-1".to_string(),
                    capability_id: "capability.expected".to_string(),
                    replay_version_id: "replay.expected".to_string(),
                    session_id: "session-shared".to_string(),
                    fresh_session: true,
                    outcome: "success".to_string(),
                    failure_message: None,
                    evidence_ids: vec!["evidence-shared".to_string()],
                    completed_at: "2026-08-31T18:00:00.000Z".to_string(),
                },
                InterfaceCompilerHostVerificationRun {
                    id: "run-2".to_string(),
                    capability_id: "capability.expected".to_string(),
                    replay_version_id: "replay.expected".to_string(),
                    session_id: "session-shared".to_string(),
                    fresh_session: true,
                    outcome: "success".to_string(),
                    failure_message: None,
                    evidence_ids: vec!["evidence-shared".to_string()],
                    completed_at: "2026-08-31T18:01:00.000Z".to_string(),
                },
            ],
        };
        assert!(validate_replay_payload(
            "replay.expected",
            "capability.expected",
            "active",
            &[InterfaceCompilerHostReplayStep::Wait { milliseconds: 1 }],
            &duplicate_runs,
            Some("2026-08-31T18:02:00.000Z"),
            None,
            None,
        )
        .is_err());
        let empty_steps = InterfaceCompilerHostReplayVerification {
            runs: vec![],
            ..verification
        };
        assert!(validate_replay_payload(
            "replay.expected",
            "capability.expected",
            "active",
            &[],
            &empty_steps,
            Some("2026-08-31T18:01:00.000Z"),
            None,
            None,
        )
        .is_err());
    }
}
