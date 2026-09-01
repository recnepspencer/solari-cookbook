//! Public contract for the demonstration execution lifecycle transition.

use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::application::InterfaceCompilerExecutionProjection;

#[derive(Clone, Debug, PartialEq)]
pub struct InterfaceCompilerStartExecutionRequest {
    pub execution_id: String,
    pub capability_id: String,
    pub replay_version_id: Option<String>,
    pub mode: String,
    pub metrics: InterfaceCompilerStartMetrics,
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
            capability_id: super::DEMO_CAPABILITY_ID.into(),
            replay_version_id: None,
            mode: "direct".into(),
            metrics: InterfaceCompilerStartMetrics::zero("2026-09-01T00:00:00.000Z"),
            credential: credential.into(),
            timeout,
        }
    }

    pub fn admission(
        execution_id: impl Into<String>,
        capability_id: impl Into<String>,
        replay_version_id: Option<String>,
        mode: impl Into<String>,
        metrics: InterfaceCompilerStartMetrics,
        credential: impl Into<String>,
        timeout: Duration,
    ) -> Self {
        Self {
            execution_id: execution_id.into(),
            capability_id: capability_id.into(),
            replay_version_id,
            mode: mode.into(),
            metrics,
            credential: credential.into(),
            timeout,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InterfaceCompilerStartMetrics {
    pub started_at: String,
    pub model_calls: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub browser_observations: u64,
    pub browser_actions: u64,
    pub estimated_model_cost_microcents: u64,
}

impl InterfaceCompilerStartMetrics {
    pub fn zero(started_at: impl Into<String>) -> Self {
        Self {
            started_at: started_at.into(),
            model_calls: 0,
            input_tokens: 0,
            output_tokens: 0,
            browser_observations: 0,
            browser_actions: 0,
            estimated_model_cost_microcents: 0,
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
