//! The explicit application-specific process boundary.
//!
//! This is a finite product transport for application-specific operations, not
//! a generic WORTH wire protocol. Only command values, published
//! projections/evidence, and typed terminal outcomes cross it. WORTH
//! runtime-local proof, graph, and recovery handles never cross the boundary.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::host::{
    InterfaceCompilerApplicationReadDenial, InterfaceCompilerApplicationReadOutcome,
    InterfaceCompilerApplicationReadRequest, InterfaceCompilerWorthHost, DEFAULT_REQUEST_TIMEOUT,
};

mod compiled_plan_read;
mod replay_recovery;
mod settlement;
mod start_execution;
pub use start_execution::{InterfaceCompilerHostCommitKind, InterfaceCompilerHostExecution};

pub const INTERFACE_COMPILER_WORTH_PROTOCOL: &str = "interface-compiler.worth-host.v1";
pub const READ_APPLICATION_OPERATION: &str = "read_application";
pub const START_EXECUTION_OPERATION: &str = "start_execution";
pub const ADMIT_EXECUTION_OPERATION: &str = "admit_execution";
pub const COMPLETE_EXECUTION_OPERATION: &str = "complete_execution";
pub const PUBLISH_DOMAIN_EVENT_OPERATION: &str = "publish_domain_event";
pub const READ_CAPABILITY_OPERATION: &str = "read_capability";
pub const READ_ACTIVE_REPLAY_OPERATION: &str = "read_active_replay";
pub const DEGRADE_REPLAY_OPERATION: &str = "degrade_replay";
pub const ACCEPT_REPLACEMENT_CANDIDATE_OPERATION: &str = "accept_replacement_candidate";
pub const RECORD_REPLACEMENT_VERIFICATION_OPERATION: &str = "record_replacement_verification";
pub const ACTIVATE_REPLACEMENT_OPERATION: &str = "activate_replacement";
pub const MAX_PROCESS_LINE_BYTES: usize = 64 * 1024;

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InterfaceCompilerHostRequest {
    pub protocol: String,
    pub request_id: String,
    pub operation: String,
    pub application_id: Option<String>,
    pub execution_id: Option<String>,
    pub capability_id: Option<String>,
    pub replay_version_id: Option<String>,
    pub broken_replay_version_id: Option<String>,
    pub credential: Option<String>,
    pub deadline_ms: Option<u64>,
    pub expected_revision: Option<u64>,
    pub expected_execution_revision: Option<u64>,
    pub expected_capability_revision: Option<u64>,
    pub expected_replay_revision: Option<u64>,
    pub expected_broken_replay_revision: Option<u64>,
    pub settlement: Option<serde_json::Value>,
    pub event: Option<serde_json::Value>,
    pub candidate: Option<serde_json::Value>,
    pub verification_run: Option<serde_json::Value>,
    pub verified_at: Option<String>,
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
    MissingCapabilityId,
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

#[derive(Clone, Debug, Serialize)]
pub struct InterfaceCompilerHostCapability {
    pub projection_kind: &'static str,
    pub id: String,
    pub revision: u64,
    pub application_id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_replay_version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_replay_version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broken_replay_version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<serde_json::Value>,
}
#[derive(Clone, Debug, Serialize)]
pub struct InterfaceCompilerHostActiveReplay {
    pub projection_kind: &'static str,
    pub id: String,
    pub revision: u64,
    pub capability_id: String,
    pub version: u64,
    pub steps: Vec<InterfaceCompilerHostReplayStep>,
    pub confidence: f64,
    pub status: String,
    pub created_at: String,
    pub discovered_from_experiment_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<String>,
    pub verification: InterfaceCompilerHostReplayVerification,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broken_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum InterfaceCompilerHostReplayStep {
    Navigate {
        url: String,
    },
    Click {
        target: InterfaceCompilerHostLocator,
    },
    Fill {
        target: InterfaceCompilerHostLocator,
        value: String,
    },
    Select {
        target: InterfaceCompilerHostLocator,
        value: String,
    },
    Wait {
        milliseconds: u64,
    },
    Read {
        target: InterfaceCompilerHostLocator,
        #[serde(rename = "outputKey")]
        output_key: String,
    },
    Assert {
        condition: serde_json::Value,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InterfaceCompilerHostLocator {
    pub semantic_description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InterfaceCompilerHostReplayVerification {
    pub required_successful_runs: u64,
    pub runs: Vec<InterfaceCompilerHostVerificationRun>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InterfaceCompilerHostVerificationRun {
    pub id: String,
    pub capability_id: String,
    pub replay_version_id: String,
    pub session_id: String,
    pub fresh_session: bool,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_message: Option<String>,
    pub evidence_ids: Vec<String>,
    pub completed_at: String,
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
    ExecutionSettled {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        commit: InterfaceCompilerHostCommitKind,
        execution: InterfaceCompilerHostExecution,
        evidence: InterfaceCompilerHostQueryEvidence,
    },
    ExecutionStale {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        execution_id: String,
        expected_revision: u64,
        actual_revision: u64,
    },
    ExecutionLifecycleInvalid {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        execution_id: String,
        current_lifecycle: String,
    },
    EventPublished {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        commit: InterfaceCompilerHostCommitKind,
        event_id: String,
        journal_revision: u64,
        evidence: InterfaceCompilerHostQueryEvidence,
    },
    CapabilityFound {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        capability: InterfaceCompilerHostCapability,
        evidence: InterfaceCompilerHostQueryEvidence,
    },
    ActiveReplayFound {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        replay: InterfaceCompilerHostActiveReplay,
        evidence: InterfaceCompilerHostQueryEvidence,
    },
    ReplayRecoveryApplied {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        commit: InterfaceCompilerHostCommitKind,
        capability: InterfaceCompilerHostCapability,
        replay: InterfaceCompilerHostActiveReplay,
        capability_evidence: InterfaceCompilerHostQueryEvidence,
        replay_evidence: InterfaceCompilerHostQueryEvidence,
    },
    ReplayRecoveryStale {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        entity: crate::host::InterfaceCompilerReplayRecoveryEntity,
        entity_id: String,
        expected_revision: u64,
        actual_revision: u64,
    },
    ReplayRecoveryStopped {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        reason: crate::host::InterfaceCompilerReplayRecoveryStopReason,
        message: String,
    },
    ReplayRecoveryCommittedProjectionUnavailable {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        commit: InterfaceCompilerHostCommitKind,
        message: String,
    },
    ReplayRecoveryDenied {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        stage: crate::host::InterfaceCompilerReplayRecoveryStage,
        message: String,
    },
    CompiledReadNotFound {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        capability_id: String,
    },
    CompiledReadDenied {
        protocol: &'static str,
        request_id: String,
        operation: &'static str,
        capability_id: String,
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
    if request.operation == ADMIT_EXECUTION_OPERATION {
        return start_execution::handle_admit_execution(request_id, request, host);
    }
    if request.operation == COMPLETE_EXECUTION_OPERATION
        || request.operation == PUBLISH_DOMAIN_EVENT_OPERATION
    {
        return settlement::handle_settlement(request_id, request, host);
    }
    if request.operation == READ_CAPABILITY_OPERATION
        || request.operation == READ_ACTIVE_REPLAY_OPERATION
    {
        return compiled_plan_read::handle_compiled_plan_read(request_id, request, host);
    }
    if matches!(
        request.operation.as_str(),
        DEGRADE_REPLAY_OPERATION
            | ACCEPT_REPLACEMENT_CANDIDATE_OPERATION
            | RECORD_REPLACEMENT_VERIFICATION_OPERATION
            | ACTIVATE_REPLACEMENT_OPERATION
    ) {
        return replay_recovery::handle_replay_recovery(request_id, request, host);
    }
    if request.operation != READ_APPLICATION_OPERATION {
        return InterfaceCompilerHostResponse::Unavailable {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
            request_id,
            operation: request.operation,
            reason: InterfaceCompilerHostUnavailableReason::Unsupported,
            message: "this host exposes only its declared application reads, execution/event operations, and typed replay-recovery operations".to_string(),
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
