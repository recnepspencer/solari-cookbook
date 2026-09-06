//! WORTH-owned replay failure and replacement progression.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use worth_query_host::facade::primary_graph;

use super::{
    InterfaceCompilerApplicationReadEvidence, InterfaceCompilerExecutionCommitKind,
    InterfaceCompilerWorthHost,
};
use crate::application::{
    InterfaceCompilerActiveReplayProjection, InterfaceCompilerCapabilityProjection,
};

mod activation;
mod candidate;
mod degradation;
mod evidence;
mod validation;
mod verification;

pub const REQUIRED_REPLACEMENT_VERIFICATION_RUNS: u64 = 3;
pub(super) const JAVASCRIPT_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub(super) const MAX_RECOVERY_JSON_BYTES: usize = 32 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceCompilerReplayRecoveryEntity {
    Execution,
    Capability,
    Replay,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceCompilerReplayRecoveryStage {
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceCompilerReplayRecoveryStopReason {
    StaleCommit,
    Cancelled,
    TimedOut,
    Aborted,
    Deferred,
    SettlementDeferred,
    Indeterminate,
}

#[derive(Clone, Debug, PartialEq)]
pub enum InterfaceCompilerReplayRecoveryOutcome {
    Applied {
        commit: InterfaceCompilerExecutionCommitKind,
        capability: InterfaceCompilerCapabilityProjection,
        capability_evidence: InterfaceCompilerApplicationReadEvidence,
        replay: InterfaceCompilerActiveReplayProjection,
        replay_evidence: InterfaceCompilerApplicationReadEvidence,
    },
    Stale {
        entity: InterfaceCompilerReplayRecoveryEntity,
        entity_id: String,
        expected: u64,
        actual: u64,
    },
    Denied {
        stage: InterfaceCompilerReplayRecoveryStage,
        detail: String,
    },
    Stopped {
        reason: InterfaceCompilerReplayRecoveryStopReason,
        detail: String,
    },
    CommittedProjectionUnavailable {
        commit: InterfaceCompilerExecutionCommitKind,
        detail: String,
    },
}

#[derive(Clone, Debug)]
pub struct DegradeReplayRequest {
    pub execution_id: String,
    pub capability_id: String,
    pub replay_version_id: String,
    pub expected_execution_revision: u64,
    pub expected_capability_revision: u64,
    pub expected_replay_revision: u64,
    pub credential: String,
    pub timeout: Duration,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InterfaceCompilerReplacementCandidate {
    pub replay_version_id: String,
    pub capability_id: String,
    pub version: u64,
    pub steps: Vec<serde_json::Value>,
    pub confidence: f64,
    pub discovered_from_experiment_id: String,
    pub supersedes: String,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct AcceptReplacementCandidateRequest {
    pub capability_id: String,
    pub broken_replay_version_id: String,
    pub expected_capability_revision: u64,
    pub expected_broken_replay_revision: u64,
    pub candidate: InterfaceCompilerReplacementCandidate,
    pub credential: String,
    pub timeout: Duration,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InterfaceCompilerVerificationOutcome {
    Success,
    Failure,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InterfaceCompilerReplacementVerificationRun {
    pub id: String,
    pub capability_id: String,
    pub replay_version_id: String,
    pub session_id: String,
    pub fresh_session: bool,
    pub outcome: InterfaceCompilerVerificationOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_message: Option<String>,
    pub evidence_ids: Vec<String>,
    pub completed_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InterfaceCompilerReplacementVerification {
    pub required_successful_runs: u64,
    #[serde(default)]
    pub evidence: Vec<InterfaceCompilerVerificationEvidence>,
    pub runs: Vec<InterfaceCompilerReplacementVerificationRun>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InterfaceCompilerVerificationEvidence {
    pub evidence_id: String,
    pub replay_version_id: String,
    pub session_id: String,
    pub kind: String,
    pub external_ref: String,
    pub captured_at: String,
}

#[derive(Clone, Debug)]
pub struct RegisterVerificationEvidenceRequest {
    pub capability_id: String,
    pub replay_version_id: String,
    pub expected_capability_revision: u64,
    pub expected_replay_revision: u64,
    pub evidence: InterfaceCompilerVerificationEvidence,
    pub credential: String,
    pub timeout: Duration,
}

#[derive(Clone, Debug)]
pub struct RecordReplacementVerificationRequest {
    pub capability_id: String,
    pub replay_version_id: String,
    pub expected_capability_revision: u64,
    pub expected_replay_revision: u64,
    pub run: InterfaceCompilerReplacementVerificationRun,
    pub credential: String,
    pub timeout: Duration,
}

#[derive(Clone, Debug)]
pub struct ActivateReplacementRequest {
    pub capability_id: String,
    pub replay_version_id: String,
    pub expected_capability_revision: u64,
    pub expected_replay_revision: u64,
    pub verified_at: String,
    pub credential: String,
    pub timeout: Duration,
}

pub(super) fn denied(
    stage: InterfaceCompilerReplayRecoveryStage,
    detail: impl Into<String>,
) -> InterfaceCompilerReplayRecoveryOutcome {
    InterfaceCompilerReplayRecoveryOutcome::Denied {
        stage,
        detail: detail.into(),
    }
}

pub(super) fn stale(
    entity: InterfaceCompilerReplayRecoveryEntity,
    entity_id: impl Into<String>,
    expected: u64,
    actual: u64,
) -> InterfaceCompilerReplayRecoveryOutcome {
    InterfaceCompilerReplayRecoveryOutcome::Stale {
        entity,
        entity_id: entity_id.into(),
        expected,
        actual,
    }
}

impl InterfaceCompilerWorthHost {
    pub(super) fn settle_recovery_commit(
        &self,
        outcome: primary_graph::WorthQueryApplicationCommitOutcome,
    ) -> Result<InterfaceCompilerExecutionCommitKind, InterfaceCompilerReplayRecoveryOutcome> {
        use primary_graph::WorthQueryApplicationCommitOutcome as Commit;

        match outcome {
            Commit::Committed(_) => Ok(InterfaceCompilerExecutionCommitKind::Committed),
            Commit::AlreadyCommitted(_) => {
                Ok(InterfaceCompilerExecutionCommitKind::AlreadyCommitted)
            }
            Commit::Denied(denial) => Err(denied(
                InterfaceCompilerReplayRecoveryStage::Commit,
                format!("WORTH compare-and-commit denied recovery: {denial:?}"),
            )),
            Commit::Stale(stale) => Err(stopped(
                InterfaceCompilerReplayRecoveryStopReason::StaleCommit,
                format!(
                    "WORTH invalidated {} recovery decision facts before commit",
                    stale.stale_fact_count()
                ),
            )),
            Commit::Cancelled => Err(stopped(
                InterfaceCompilerReplayRecoveryStopReason::Cancelled,
                "WORTH cancelled recovery before a committed result was established",
            )),
            Commit::TimedOut => Err(stopped(
                InterfaceCompilerReplayRecoveryStopReason::TimedOut,
                "WORTH timed out before a committed recovery result was established",
            )),
            Commit::Aborted => Err(stopped(
                InterfaceCompilerReplayRecoveryStopReason::Aborted,
                "WORTH aborted the recovery commit",
            )),
            Commit::Deferred(deferred) => Err(stopped(
                InterfaceCompilerReplayRecoveryStopReason::Deferred,
                format!("WORTH deferred the recovery commit: {deferred:?}"),
            )),
            Commit::SettlementDeferred(deferred) => self
                .application
                .recover_deferred_application_settlement(&deferred)
                .map(|_| InterfaceCompilerExecutionCommitKind::Committed)
                .map_err(|error| {
                    stopped(
                        InterfaceCompilerReplayRecoveryStopReason::SettlementDeferred,
                        format!(
                            "WORTH could not finish recovery publication settlement: {error:?}"
                        ),
                    )
                }),
            Commit::Indeterminate(evidence) => Err(stopped(
                InterfaceCompilerReplayRecoveryStopReason::Indeterminate,
                format!("WORTH could not resolve the recovery commit: {evidence:?}"),
            )),
        }
    }

    pub(super) fn project_recovery(
        &self,
        capability_id: &str,
        replay_id: &str,
        credential: &str,
        timeout: Duration,
        commit: InterfaceCompilerExecutionCommitKind,
    ) -> InterfaceCompilerReplayRecoveryOutcome {
        let started_at = std::time::Instant::now();
        let capability = self.read_capability(super::InterfaceCompilerCompiledReadRequest::new(
            capability_id,
            credential,
            timeout,
        ));
        let Some(remaining) = timeout.checked_sub(started_at.elapsed()) else {
            return InterfaceCompilerReplayRecoveryOutcome::CommittedProjectionUnavailable {
                commit,
                detail: "WORTH committed recovery but projection deadline elapsed".to_string(),
            };
        };
        let replay = self.read_replay(super::InterfaceCompilerReplayReadRequest {
            capability_id: capability_id.to_string(),
            replay_id: replay_id.to_string(),
            credential: credential.to_string(),
            timeout: remaining,
        });
        match (capability, replay) {
            (
                super::InterfaceCompilerCapabilityReadOutcome::Found {
                    projection: capability,
                    evidence: capability_evidence,
                },
                super::InterfaceCompilerReplayReadOutcome::Found {
                    projection: replay,
                    evidence: replay_evidence,
                },
            ) if super::compiled_plan_read::recovery_projection_pair_is_consistent(
                &capability,
                &capability_evidence,
                &replay,
                &replay_evidence,
            ) => InterfaceCompilerReplayRecoveryOutcome::Applied {
                commit,
                capability,
                capability_evidence,
                replay,
                replay_evidence,
            },
            (capability, replay) => {
                InterfaceCompilerReplayRecoveryOutcome::CommittedProjectionUnavailable {
                    commit,
                    detail: format!(
                        "WORTH committed recovery but could not publish its projections: capability={capability:?}, replay={replay:?}"
                    ),
                }
            }
        }
    }
}

pub(super) fn valid_context(credential: &str, timeout: Duration) -> bool {
    !credential.trim().is_empty() && !timeout.is_zero() && timeout <= super::MAX_REQUEST_TIMEOUT
}

fn stopped(
    reason: InterfaceCompilerReplayRecoveryStopReason,
    detail: impl Into<String>,
) -> InterfaceCompilerReplayRecoveryOutcome {
    InterfaceCompilerReplayRecoveryOutcome::Stopped {
        reason,
        detail: detail.into(),
    }
}

pub(super) fn valid_identity(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix) && valid_external_identity(value)
}

/// Session identities originate at the browser adapter boundary and are not
/// assigned an Interface Compiler namespace. Keep their wire shape bounded
/// without rejecting real provider-issued identifiers such as
/// `solari.session.*`.
pub(super) fn valid_external_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b':'))
}

pub(super) fn valid_timestamp(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

pub(super) fn valid_wire_revision(value: u64) -> bool {
    value <= JAVASCRIPT_MAX_SAFE_INTEGER
}

pub(super) fn recovery_binding(
    kind: &[u8],
    key: &str,
    correlation: &str,
    intent: &[u8],
) -> primary_graph::WorthQueryApplicationIdempotencyBinding {
    super::settlement_support::binding(kind, key, correlation, intent)
}

#[cfg(test)]
mod tests {
    use super::valid_external_identity;

    #[test]
    fn accepts_the_colon_delimited_solari_session_identity_seen_in_live_evidence() {
        assert!(valid_external_identity(
            "ip-10-0-11-229:044b6e0a:cmth8hm1m0000000000000000:1780W-e6c9a11f"
        ));
    }

    #[test]
    fn rejects_session_identity_characters_outside_the_wire_allowlist() {
        assert!(!valid_external_identity("solari session/with whitespace"));
    }
}
