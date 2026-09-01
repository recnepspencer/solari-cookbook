//! Wire mapping for the one admitted execution transition.

use std::time::Duration;

use serde::Serialize;

use super::{
    InterfaceCompilerHostDenialStage, InterfaceCompilerHostInvalidRequestReason,
    InterfaceCompilerHostQueryEvidence, InterfaceCompilerHostRequest,
    InterfaceCompilerHostResponse, ADMIT_EXECUTION_OPERATION, INTERFACE_COMPILER_WORTH_PROTOCOL,
    START_EXECUTION_OPERATION,
};
use crate::host::{
    InterfaceCompilerExecutionCommitKind, InterfaceCompilerStartExecutionDenialStage,
    InterfaceCompilerStartExecutionOutcome, InterfaceCompilerStartExecutionRequest,
    InterfaceCompilerWorthHost, DEFAULT_REQUEST_TIMEOUT,
};

#[derive(Clone, Debug, Serialize)]
pub struct InterfaceCompilerHostExecution {
    pub projection_kind: &'static str,
    pub execution_id: String,
    pub lifecycle: String,
    pub revision: u64,
    pub settlement: serde_json::Value,
    pub capability_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay_version_id: Option<String>,
    pub mode: String,
    pub metrics: serde_json::Value,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceCompilerHostCommitKind {
    Committed,
    AlreadyCommitted,
}

pub(super) fn handle_start_execution(
    request_id: String,
    request: InterfaceCompilerHostRequest,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerHostResponse {
    let Some(execution_id) = request.execution_id else {
        return invalid_request(
            request_id,
            InterfaceCompilerHostInvalidRequestReason::MissingExecutionId,
            "start_execution requires execution_id",
        );
    };
    let Some(credential) = request.credential else {
        return invalid_request(
            request_id,
            InterfaceCompilerHostInvalidRequestReason::MissingCredential,
            "start_execution requires credential",
        );
    };
    let timeout = request
        .deadline_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_REQUEST_TIMEOUT);
    let outcome = host.start_execution(InterfaceCompilerStartExecutionRequest::new(
        execution_id.clone(),
        credential,
        timeout,
    ));
    map_outcome(request_id, START_EXECUTION_OPERATION, execution_id, outcome)
}

pub(super) fn handle_admit_execution(
    request_id: String,
    request: InterfaceCompilerHostRequest,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerHostResponse {
    let execution_id = match request.execution_id {
        Some(value) => value,
        None => {
            return invalid_request(
                request_id,
                InterfaceCompilerHostInvalidRequestReason::MissingExecutionId,
                "admit_execution requires execution_id",
            )
        }
    };
    let capability_id = match request.capability_id {
        Some(value) => value,
        None => {
            return invalid_request(
                request_id,
                InterfaceCompilerHostInvalidRequestReason::MissingCapabilityId,
                "admit_execution requires capability_id",
            )
        }
    };
    let credential = match request.credential {
        Some(value) => value,
        None => {
            return invalid_request(
                request_id,
                InterfaceCompilerHostInvalidRequestReason::MissingCredential,
                "admit_execution requires credential",
            )
        }
    };
    let admission = match request.settlement {
        Some(value) => value,
        None => {
            return invalid_request(
                request_id,
                InterfaceCompilerHostInvalidRequestReason::MalformedJson,
                "admit_execution requires admission",
            )
        }
    };
    let mode = admission
        .get("mode")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let replay_version_id = admission
        .get("replayVersionId")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let metrics = match admission
        .get("metrics")
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
    {
        Some(value) => value,
        None => {
            return invalid_request(
                request_id,
                InterfaceCompilerHostInvalidRequestReason::MalformedJson,
                "admit_execution requires valid start metrics",
            )
        }
    };
    let timeout = request
        .deadline_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_REQUEST_TIMEOUT);
    let outcome = host.admit_execution(InterfaceCompilerStartExecutionRequest::admission(
        execution_id.clone(),
        capability_id,
        replay_version_id,
        mode,
        metrics,
        credential,
        timeout,
    ));
    map_outcome(request_id, ADMIT_EXECUTION_OPERATION, execution_id, outcome)
}

fn map_outcome(
    request_id: String,
    operation: &'static str,
    requested_execution_id: String,
    outcome: InterfaceCompilerStartExecutionOutcome,
) -> InterfaceCompilerHostResponse {
    match outcome {
        InterfaceCompilerStartExecutionOutcome::Transitioned {
            commit,
            projection,
            evidence,
        } => InterfaceCompilerHostResponse::ExecutionTransitioned {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            operation,
            commit: match commit {
                InterfaceCompilerExecutionCommitKind::Committed => {
                    InterfaceCompilerHostCommitKind::Committed
                }
                InterfaceCompilerExecutionCommitKind::AlreadyCommitted => {
                    InterfaceCompilerHostCommitKind::AlreadyCommitted
                }
            },
            execution: InterfaceCompilerHostExecution {
                projection_kind: "worth_execution",
                execution_id: projection.execution_id,
                lifecycle: projection.lifecycle,
                revision: projection.revision,
                settlement: serde_json::from_str(&projection.settlement_json)
                    .unwrap_or(serde_json::Value::Null),
                capability_id: projection.capability_id,
                replay_version_id: if projection.replay_version_id.is_empty() {
                    None
                } else {
                    Some(projection.replay_version_id)
                },
                mode: projection.mode,
                metrics: serde_json::from_str(&projection.metrics_json)
                    .unwrap_or(serde_json::Value::Null),
            },
            evidence: InterfaceCompilerHostQueryEvidence {
                query_name: evidence.query_name,
                query_identity: evidence.query_identity,
                basis_version: evidence.basis_version,
                projected_record_count: evidence.projected_record_count,
                projected_field_count: evidence.projected_field_count,
                basis_released: evidence.basis_released,
            },
        },
        InterfaceCompilerStartExecutionOutcome::LifecycleNotPending {
            execution_id,
            current_lifecycle,
        } => InterfaceCompilerHostResponse::LifecycleNotPending {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            operation,
            execution_id,
            current_lifecycle,
        },
        InterfaceCompilerStartExecutionOutcome::Denied { stage, detail } => {
            InterfaceCompilerHostResponse::ExecutionDenied {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation,
                execution_id: requested_execution_id,
                stage: map_denial_stage(stage),
                kind: format!("{stage:?}"),
                message: detail,
            }
        }
    }
}

fn invalid_request(
    request_id: String,
    reason: InterfaceCompilerHostInvalidRequestReason,
    message: &str,
) -> InterfaceCompilerHostResponse {
    InterfaceCompilerHostResponse::InvalidRequest {
        protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
        request_id,
        reason,
        message: message.to_string(),
    }
}

pub(super) fn map_denial_stage(
    stage: InterfaceCompilerStartExecutionDenialStage,
) -> InterfaceCompilerHostDenialStage {
    match stage {
        InterfaceCompilerStartExecutionDenialStage::Request => {
            InterfaceCompilerHostDenialStage::Request
        }
        InterfaceCompilerStartExecutionDenialStage::Authentication => {
            InterfaceCompilerHostDenialStage::Authentication
        }
        InterfaceCompilerStartExecutionDenialStage::PrincipalResolution => {
            InterfaceCompilerHostDenialStage::PrincipalResolution
        }
        InterfaceCompilerStartExecutionDenialStage::EntityResolution => {
            InterfaceCompilerHostDenialStage::EntityResolution
        }
        InterfaceCompilerStartExecutionDenialStage::OperationAdmission => {
            InterfaceCompilerHostDenialStage::OperationAdmission
        }
        InterfaceCompilerStartExecutionDenialStage::DependencyProjection => {
            InterfaceCompilerHostDenialStage::DependencyProjection
        }
        InterfaceCompilerStartExecutionDenialStage::EffectProgram => {
            InterfaceCompilerHostDenialStage::EffectProgram
        }
        InterfaceCompilerStartExecutionDenialStage::Commit => {
            InterfaceCompilerHostDenialStage::Commit
        }
        InterfaceCompilerStartExecutionDenialStage::Query => {
            InterfaceCompilerHostDenialStage::Query
        }
    }
}
