use super::{InterfaceCompilerStartExecutionDenialStage, SettlementOutcome};
use crate::application::InterfaceCompilerEventJournalProjection;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use worth_query_host::facade::{admission, primary_graph};
pub(super) fn scope(
    timeout: Duration,
) -> admission::authenticated_principal::WorthQueryRequestScope {
    let cancellation = admission::authenticated_principal::WorthQueryCancellationSource::new();
    admission::authenticated_principal::WorthQueryRequestScope::new(
        Instant::now() + timeout,
        cancellation.token(),
    )
}
pub(super) fn denied<P>(detail: impl Into<String>) -> SettlementOutcome<P> {
    SettlementOutcome::Denied {
        stage: InterfaceCompilerStartExecutionDenialStage::Request,
        detail: detail.into(),
    }
}
pub(super) fn binding(
    kind: &[u8],
    key: &str,
    correlation: &str,
    intent: &[u8],
) -> primary_graph::WorthQueryApplicationIdempotencyBinding {
    fn digest(parts: &[&[u8]]) -> [u8; 32] {
        let mut hash = Sha256::new();
        for part in parts {
            hash.update(part);
            hash.update([0])
        }
        hash.finalize().into()
    }
    primary_graph::WorthQueryApplicationIdempotencyBinding::new(
        digest(&[kind, key.as_bytes()]),
        digest(&[kind, key.as_bytes(), correlation.as_bytes(), intent]),
    )
}
pub(super) fn allowed_event(value: &str) -> bool {
    matches!(
        value,
        "direct.started"
            | "browser.observed"
            | "model.called"
            | "browser.action"
            | "direct.completed"
            | "exploration.started"
            | "experiment.executed"
            | "replay.proposed"
            | "verification.started"
            | "verification.succeeded"
            | "replay.activated"
            | "compiled.started"
            | "replay.started"
            | "replay.succeeded"
            | "replay.failed"
            | "capability.degraded"
            | "exploration.resumed"
            | "replay.superseded"
            | "capability.healthy"
    )
}
pub(super) fn settlement_lifecycle(settlement: &serde_json::Value) -> &str {
    settlement
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("")
}
pub(super) fn valid_settlement(settlement: &serde_json::Value) -> bool {
    let status = settlement_lifecycle(settlement);
    let completion = settlement
        .get("completion")
        .and_then(|value| value.as_object());
    let kind = completion
        .and_then(|value| value.get("kind"))
        .and_then(|value| value.as_str());
    let ended_at = settlement.get("endedAt").and_then(|value| value.as_str());
    let matching = matches!(
        (status, kind),
        ("success", Some("success"))
            | ("failure", Some("failure"))
            | ("stopped", Some("safety_stop"))
    );
    matching && ended_at.is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok())
}
pub(super) fn settlement_follows_start(
    start_metrics_json: Option<&str>,
    settlement: &serde_json::Value,
) -> bool {
    let started_at = start_metrics_json
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .and_then(|value| {
            value
                .get("startedAt")
                .and_then(|entry| entry.as_str())
                .map(str::to_owned)
        });
    let ended_at = settlement.get("endedAt").and_then(|value| value.as_str());
    match (started_at, ended_at) {
        (Some(started), Some(ended)) => chrono::DateTime::parse_from_rfc3339(&started)
            .ok()
            .zip(chrono::DateTime::parse_from_rfc3339(ended).ok())
            .is_some_and(|(started, ended)| ended >= started),
        _ => false,
    }
}
pub(super) fn valid_measured_event(event: &serde_json::Value) -> bool {
    let event_type = event
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let Some(payload) = event.get("payload").and_then(|value| value.as_object()) else {
        return false;
    };
    let has_execution = payload
        .get("executionId")
        .and_then(|value| value.as_str())
        .is_some();
    match event_type {
        "model.called" => {
            has_execution
                && payload
                    .get("inputTokens")
                    .and_then(|value| value.as_u64())
                    .is_some()
                && payload
                    .get("outputTokens")
                    .and_then(|value| value.as_u64())
                    .is_some()
                && payload
                    .get("estimatedModelCostMicrocents")
                    .and_then(|value| value.as_u64())
                    .is_some()
        }
        "browser.observed" | "browser.action" => has_execution,
        _ => true,
    }
}
pub(super) fn journal_contains_event(
    journal: &InterfaceCompilerEventJournalProjection,
    event_id: &str,
    event: &serde_json::Value,
) -> bool {
    serde_json::from_str::<Vec<serde_json::Value>>(&journal.events_json)
        .map(|events| {
            events.iter().any(|retained| {
                retained.get("eventId").and_then(|value| value.as_str()) == Some(event_id)
                    && retained == event
            })
        })
        .unwrap_or(false)
}
