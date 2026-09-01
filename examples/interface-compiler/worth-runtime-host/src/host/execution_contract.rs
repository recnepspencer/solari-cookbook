//! Public contract for the demonstration execution lifecycle transition.

use std::time::Duration;

use crate::application::InterfaceCompilerExecutionProjection;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerStartExecutionRequest {
    pub execution_id: String,
    pub credential: String,
    pub timeout: Duration,
}

impl InterfaceCompilerStartExecutionRequest {
    pub fn new(
        execution_id: impl Into<String>,
        credential: impl Into<String>,
        timeout: Duration,
    ) -> Self {
        Self {
            execution_id: execution_id.into(),
            credential: credential.into(),
            timeout,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerExecutionCommitKind {
    Committed,
    AlreadyCommitted,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerExecutionQueryEvidence {
    pub query_name: String,
    pub query_identity: String,
    pub basis_version: u64,
    pub projected_record_count: usize,
    pub projected_field_count: usize,
    pub basis_released: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerStartExecutionOutcome {
    Transitioned {
        commit: InterfaceCompilerExecutionCommitKind,
        projection: InterfaceCompilerExecutionProjection,
        evidence: InterfaceCompilerExecutionQueryEvidence,
    },
    Denied {
        stage: InterfaceCompilerStartExecutionDenialStage,
        detail: String,
    },
    LifecycleNotPending {
        execution_id: String,
        current_lifecycle: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerStartExecutionDenialStage {
    Request,
    Authentication,
    PrincipalResolution,
    EntityResolution,
    OperationAdmission,
    DependencyProjection,
    EffectProgram,
    Commit,
    Query,
}
