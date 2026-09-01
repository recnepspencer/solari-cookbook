use super::*;
use crate::host::{CompleteExecutionRequest, PublishDomainEventRequest, SettlementOutcome};
use std::time::Duration;

pub(super) fn handle_settlement(
    request_id: String,
    request: InterfaceCompilerHostRequest,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerHostResponse {
    let operation = request.operation.clone();
    let credential = match request.credential.clone() {
        Some(v) => v,
        None => {
            return invalid(
                request_id,
                InterfaceCompilerHostInvalidRequestReason::MissingCredential,
                "credential is required",
            )
        }
    };
    let timeout = request
        .deadline_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_REQUEST_TIMEOUT);
    if operation == COMPLETE_EXECUTION_OPERATION {
        let execution_id = match request.execution_id {
            Some(v) => v,
            None => {
                return invalid(
                    request_id,
                    InterfaceCompilerHostInvalidRequestReason::MissingExecutionId,
                    "execution_id is required",
                )
            }
        };
        let expected = match request.expected_revision {
            Some(v) => v,
            None => {
                return invalid(
                    request_id,
                    InterfaceCompilerHostInvalidRequestReason::MissingExecutionId,
                    "expected_revision is required",
                )
            }
        };
        let settlement = match request.settlement {
            Some(v) => v,
            None => {
                return invalid(
                    request_id,
                    InterfaceCompilerHostInvalidRequestReason::MissingExecutionId,
                    "settlement is required",
                )
            }
        };
        return map_completion(
            request_id,
            execution_id.clone(),
            host.complete_execution(CompleteExecutionRequest {
                execution_id,
                expected_revision: expected,
                settlement,
                credential,
                timeout,
            }),
        );
    }
    let event = match request.event {
        Some(v) => v,
        None => {
            return invalid(
                request_id,
                InterfaceCompilerHostInvalidRequestReason::MissingExecutionId,
                "event is required",
            )
        }
    };
    let event_id = event
        .get("eventId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    map_event(
        request_id,
        event_id,
        host.publish_domain_event(PublishDomainEventRequest {
            event,
            credential,
            timeout,
        }),
    )
}
fn map_completion(
    id: String,
    execution_id: String,
    outcome: SettlementOutcome<crate::application::InterfaceCompilerExecutionProjection>,
) -> InterfaceCompilerHostResponse {
    match outcome {
        SettlementOutcome::Applied {
            commit,
            projection,
            evidence,
        } => InterfaceCompilerHostResponse::ExecutionSettled {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id: id,
            operation: COMPLETE_EXECUTION_OPERATION,
            commit: commit_kind(commit),
            execution: execution(projection),
            evidence: evidence_wire(evidence),
        },
        SettlementOutcome::Stale { expected, actual } => {
            InterfaceCompilerHostResponse::ExecutionStale {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id: id,
                operation: COMPLETE_EXECUTION_OPERATION,
                execution_id,
                expected_revision: expected,
                actual_revision: actual,
            }
        }
        SettlementOutcome::InvalidLifecycle { current } => {
            InterfaceCompilerHostResponse::ExecutionLifecycleInvalid {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id: id,
                operation: COMPLETE_EXECUTION_OPERATION,
                execution_id,
                current_lifecycle: current,
            }
        }
        SettlementOutcome::Denied { stage, detail } => {
            InterfaceCompilerHostResponse::ExecutionDenied {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id: id,
                operation: COMPLETE_EXECUTION_OPERATION,
                execution_id,
                stage: super::start_execution::map_denial_stage(stage),
                kind: format!("{stage:?}"),
                message: detail,
            }
        }
    }
}
fn map_event(
    id: String,
    event_id: String,
    outcome: SettlementOutcome<crate::application::InterfaceCompilerEventJournalProjection>,
) -> InterfaceCompilerHostResponse {
    match outcome {
        SettlementOutcome::Applied {
            commit,
            projection,
            evidence,
        } => InterfaceCompilerHostResponse::EventPublished {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id: id,
            operation: PUBLISH_DOMAIN_EVENT_OPERATION,
            commit: commit_kind(commit),
            event_id,
            journal_revision: projection.revision,
            evidence: evidence_wire(evidence),
        },
        SettlementOutcome::Denied { stage, detail } => {
            InterfaceCompilerHostResponse::ExecutionDenied {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id: id,
                operation: PUBLISH_DOMAIN_EVENT_OPERATION,
                execution_id: event_id,
                stage: super::start_execution::map_denial_stage(stage),
                kind: format!("{stage:?}"),
                message: detail,
            }
        }
        _ => InterfaceCompilerHostResponse::ExecutionDenied {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id: id,
            operation: PUBLISH_DOMAIN_EVENT_OPERATION,
            execution_id: event_id,
            stage: InterfaceCompilerHostDenialStage::Commit,
            kind: "publication_conflict".to_string(),
            message: "event publication conflicted".to_string(),
        },
    }
}
fn execution(
    p: crate::application::InterfaceCompilerExecutionProjection,
) -> InterfaceCompilerHostExecution {
    InterfaceCompilerHostExecution {
        projection_kind: "worth_execution",
        execution_id: p.execution_id,
        lifecycle: p.lifecycle,
        revision: p.revision,
        settlement: serde_json::from_str(&p.settlement_json).unwrap_or(serde_json::Value::Null),
        capability_id: p.capability_id,
        replay_version_id: if p.replay_version_id.is_empty() {
            None
        } else {
            Some(p.replay_version_id)
        },
        mode: p.mode,
        metrics: serde_json::from_str(&p.metrics_json).unwrap_or(serde_json::Value::Null),
    }
}
fn commit_kind(
    v: crate::host::InterfaceCompilerExecutionCommitKind,
) -> InterfaceCompilerHostCommitKind {
    match v {
        crate::host::InterfaceCompilerExecutionCommitKind::Committed => {
            InterfaceCompilerHostCommitKind::Committed
        }
        crate::host::InterfaceCompilerExecutionCommitKind::AlreadyCommitted => {
            InterfaceCompilerHostCommitKind::AlreadyCommitted
        }
    }
}
fn evidence_wire(
    v: crate::host::InterfaceCompilerExecutionQueryEvidence,
) -> InterfaceCompilerHostQueryEvidence {
    InterfaceCompilerHostQueryEvidence {
        query_name: v.query_name,
        query_identity: v.query_identity,
        basis_version: v.basis_version,
        projected_record_count: v.projected_record_count,
        projected_field_count: v.projected_field_count,
        basis_released: v.basis_released,
    }
}
fn invalid(
    id: String,
    reason: InterfaceCompilerHostInvalidRequestReason,
    message: &str,
) -> InterfaceCompilerHostResponse {
    InterfaceCompilerHostResponse::InvalidRequest {
        protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
        request_id: id,
        reason,
        message: message.to_string(),
    }
}
