//! The explicit application-specific process boundary.
//!
//! This is a product transport for two application operations, not a generic
//! WORTH wire protocol. Only published projections/evidence and typed terminal
//! outcomes cross it. WORTH runtime-local proof, graph, and recovery handles
//! never cross the boundary.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::host::{
    InterfaceCompilerApplicationReadDenial, InterfaceCompilerApplicationReadOutcome,
    InterfaceCompilerApplicationReadRequest, InterfaceCompilerWorthHost, DEFAULT_REQUEST_TIMEOUT,
};

mod start_execution;
pub use start_execution::{InterfaceCompilerHostCommitKind, InterfaceCompilerHostExecution};

pub const INTERFACE_COMPILER_WORTH_PROTOCOL: &str = "interface-compiler.worth-host.v1";
pub const READ_APPLICATION_OPERATION: &str = "read_application";
pub const START_EXECUTION_OPERATION: &str = "start_execution";
pub const MAX_PROCESS_LINE_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InterfaceCompilerHostRequest {
    pub protocol: String,
    pub request_id: String,
    pub operation: String,
    pub application_id: Option<String>,
    pub execution_id: Option<String>,
    pub credential: Option<String>,
    pub deadline_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceCompilerHostDenialStage {
    Request,
    Authentication,
    PrincipalResolution,
    EntityResolution,
    Query,
    Projection,
    OperationAdmission,
    DependencyProjection,
    EffectProgram,
    Commit,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceCompilerHostUnavailableReason {
    Unsupported,
    NotConfigured,
    ProtocolMismatch,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceCompilerHostInvalidRequestReason {
    ProtocolMismatch,
    EmptyRequestId,
    EmptyOperation,
    MissingApplicationId,
    MissingExecutionId,
    MissingCredential,
    MalformedJson,
    InvalidUtf8,
    LineTooLarge,
}

#[derive(Clone, Debug, Serialize)]
pub struct InterfaceCompilerHostApplication {
    pub projection_kind: &'static str,
    pub id: String,
    pub revision: u64,
    pub name: String,
    pub base_url: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct InterfaceCompilerHostQueryEvidence {
    pub query_name: String,
    pub query_identity: String,
    pub basis_version: u64,
    pub projected_record_count: usize,
    pub projected_field_count: usize,
    pub basis_released: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum InterfaceCompilerHostResponse {
    Found {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        application: InterfaceCompilerHostApplication,
        evidence: InterfaceCompilerHostQueryEvidence,
    },
    NotFound {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        application_id: String,
    },
    Denied {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        application_id: String,
        stage: InterfaceCompilerHostDenialStage,
        kind: String,
        message: String,
    },
    ExecutionTransitioned {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        commit: InterfaceCompilerHostCommitKind,
        execution: InterfaceCompilerHostExecution,
        evidence: InterfaceCompilerHostQueryEvidence,
    },
    LifecycleNotPending {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        execution_id: String,
        current_lifecycle: String,
    },
    ExecutionDenied {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        execution_id: String,
        stage: InterfaceCompilerHostDenialStage,
        kind: String,
        message: String,
    },
    Unavailable {
        protocol: &'static str,
        request_id: String,
        operation: String,
        reason: InterfaceCompilerHostUnavailableReason,
        message: String,
    },
    InvalidRequest {
        protocol: &'static str,
        request_id: String,
        reason: InterfaceCompilerHostInvalidRequestReason,
        message: String,
    },
}

pub fn handle_request(
    request: InterfaceCompilerHostRequest,
    host: &InterfaceCompilerWorthHost,
) -> InterfaceCompilerHostResponse {
    let request_id = request.request_id.clone();
    if request.protocol != INTERFACE_COMPILER_WORTH_PROTOCOL {
        return InterfaceCompilerHostResponse::Unavailable {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            operation: request.operation,
            reason: InterfaceCompilerHostUnavailableReason::ProtocolMismatch,
            message: "the process protocol identity is not admitted".to_string(),
        };
    }
    if request_id.trim().is_empty() {
        return InterfaceCompilerHostResponse::InvalidRequest {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            reason: InterfaceCompilerHostInvalidRequestReason::EmptyRequestId,
            message: "request_id must not be empty".to_string(),
        };
    }
    if request.operation.trim().is_empty() {
        return InterfaceCompilerHostResponse::InvalidRequest {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            reason: InterfaceCompilerHostInvalidRequestReason::EmptyOperation,
            message: "operation must not be empty".to_string(),
        };
    }
    if request.operation == START_EXECUTION_OPERATION {
        return start_execution::handle_start_execution(request_id, request, host);
    }
    if request.operation != READ_APPLICATION_OPERATION {
        return InterfaceCompilerHostResponse::Unavailable {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            operation: request.operation,
            reason: InterfaceCompilerHostUnavailableReason::Unsupported,
            message: "this host exposes only read_application and start_execution".to_string(),
        };
    }
    let Some(application_id) = request.application_id else {
        return InterfaceCompilerHostResponse::InvalidRequest {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            reason: InterfaceCompilerHostInvalidRequestReason::MissingApplicationId,
            message: "read_application requires application_id".to_string(),
        };
    };
    let Some(credential) = request.credential else {
        return InterfaceCompilerHostResponse::InvalidRequest {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            reason: InterfaceCompilerHostInvalidRequestReason::MissingCredential,
            message: "read_application requires credential".to_string(),
        };
    };
    let timeout = request
        .deadline_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_REQUEST_TIMEOUT);
    let outcome = host.read_application(InterfaceCompilerApplicationReadRequest::new(
        application_id,
        credential,
        timeout,
    ));
    map_read_outcome(request_id, outcome)
}

fn map_read_outcome(
    request_id: String,
    outcome: InterfaceCompilerApplicationReadOutcome,
) -> InterfaceCompilerHostResponse {
    match outcome {
        InterfaceCompilerApplicationReadOutcome::Found {
            projection,
            evidence,
        } => InterfaceCompilerHostResponse::Found {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            operation: READ_APPLICATION_OPERATION,
            application: InterfaceCompilerHostApplication {
                projection_kind: "worth_application",
                id: projection.id,
                revision: projection.revision,
                name: projection.name,
                base_url: projection.base_url,
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
        InterfaceCompilerApplicationReadOutcome::NotFound { application_id } => {
            InterfaceCompilerHostResponse::NotFound {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation: READ_APPLICATION_OPERATION,
                application_id,
            }
        }
        InterfaceCompilerApplicationReadOutcome::Denied {
            application_id,
            denial,
        } => {
            let (stage, kind, message) = denial_details(&denial);
            InterfaceCompilerHostResponse::Denied {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id,
                operation: READ_APPLICATION_OPERATION,
                application_id,
                stage,
                kind,
                message,
            }
        }
    }
}

fn denial_details(
    denial: &InterfaceCompilerApplicationReadDenial,
) -> (InterfaceCompilerHostDenialStage, String, String) {
    match denial {
        InterfaceCompilerApplicationReadDenial::InvalidRequest(reason) => (
            InterfaceCompilerHostDenialStage::Request,
            format!("{reason:?}"),
            "the request was outside the host's admitted bounds".to_string(),
        ),
        InterfaceCompilerApplicationReadDenial::Authentication(kind) => (
            InterfaceCompilerHostDenialStage::Authentication,
            format!("{kind:?}"),
            "WORTH authentication admission rejected the credential".to_string(),
        ),
        InterfaceCompilerApplicationReadDenial::PrincipalResolution(kind) => (
            InterfaceCompilerHostDenialStage::PrincipalResolution,
            format!("{kind:?}"),
            "WORTH could not resolve the authenticated application principal".to_string(),
        ),
        InterfaceCompilerApplicationReadDenial::EntityResolution(kind) => (
            InterfaceCompilerHostDenialStage::EntityResolution,
            format!("{kind:?}"),
            "WORTH could not resolve the requested application entity".to_string(),
        ),
        InterfaceCompilerApplicationReadDenial::QueryNotInstalled => (
            InterfaceCompilerHostDenialStage::Query,
            "query_not_installed".to_string(),
            "the admitted application query is not installed".to_string(),
        ),
        InterfaceCompilerApplicationReadDenial::QueryAdmission(kind) => (
            InterfaceCompilerHostDenialStage::Query,
            format!("{kind:?}"),
            "WORTH query admission rejected the request".to_string(),
        ),
        InterfaceCompilerApplicationReadDenial::QueryExecution(kind) => (
            InterfaceCompilerHostDenialStage::Query,
            format!("{kind:?}"),
            "WORTH query execution did not produce an admitted result".to_string(),
        ),
        InterfaceCompilerApplicationReadDenial::Projection(kind) => (
            InterfaceCompilerHostDenialStage::Projection,
            format!("{kind:?}"),
            "WORTH rejected the typed application projection".to_string(),
        ),
    }
}
