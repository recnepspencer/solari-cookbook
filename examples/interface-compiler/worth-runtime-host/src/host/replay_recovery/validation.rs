//! Validation for untrusted recovery commands and retained recovery payloads.
//!
//! These checks all protect the same boundary: JSON that arrived before WORTH
//! admitted an operation. They intentionally live together rather than beside
//! each individual state transition.

use std::collections::HashSet;

use super::{
    valid_external_identity, valid_identity, valid_timestamp, valid_wire_revision,
    AcceptReplacementCandidateRequest, InterfaceCompilerReplacementVerification,
    InterfaceCompilerReplacementVerificationRun, InterfaceCompilerVerificationOutcome,
    MAX_RECOVERY_JSON_BYTES, REQUIRED_REPLACEMENT_VERIFICATION_RUNS,
};

pub(super) fn valid_candidate_request(request: &AcceptReplacementCandidateRequest) -> bool {
    valid_wire_revision(request.expected_capability_revision)
        && valid_wire_revision(request.expected_broken_replay_revision)
        && valid_identity(&request.candidate.replay_version_id, "replay.")
        && valid_identity(&request.candidate.capability_id, "capability.")
        && valid_identity(
            &request.candidate.discovered_from_experiment_id,
            "experiment.",
        )
        && valid_identity(&request.candidate.supersedes, "replay.")
        && request.candidate.version > 0
        && valid_wire_revision(request.candidate.version)
        && valid_timestamp(&request.candidate.created_at)
        && request.candidate.confidence.is_finite()
        && (0.0..=1.0).contains(&request.candidate.confidence)
        && ((request.candidate.confidence * 1000.0).fract().abs() < f64::EPSILON)
        && !request.candidate.steps.is_empty()
        && request.candidate.steps.iter().all(valid_replay_step)
        && candidate_json(request).len() <= MAX_RECOVERY_JSON_BYTES
}

pub(super) fn candidate_json(request: &AcceptReplacementCandidateRequest) -> String {
    serde_json::json!({
        "replayVersionId": request.candidate.replay_version_id,
        "capabilityId": request.candidate.capability_id,
        "version": request.candidate.version,
        "steps": request.candidate.steps,
        "confidence": request.candidate.confidence,
        "discoveredFromExperimentId": request.candidate.discovered_from_experiment_id,
        "supersedes": request.candidate.supersedes,
        "createdAt": request.candidate.created_at,
    })
    .to_string()
}

pub(super) fn valid_verification_request_revisions(
    expected_capability_revision: u64,
    expected_replay_revision: u64,
) -> bool {
    valid_wire_revision(expected_capability_revision)
        && valid_wire_revision(expected_replay_revision)
}

pub(super) fn valid_verification_run(run: &InterfaceCompilerReplacementVerificationRun) -> bool {
    valid_identity(&run.id, "verification.")
        && valid_identity(&run.capability_id, "capability.")
        && valid_identity(&run.replay_version_id, "replay.")
        && valid_external_identity(&run.session_id)
        && run.fresh_session
        && valid_timestamp(&run.completed_at)
        && !run.evidence_ids.is_empty()
        && run
            .evidence_ids
            .iter()
            .all(|value| valid_identity(value, "evidence."))
        && run.evidence_ids.iter().collect::<HashSet<_>>().len() == run.evidence_ids.len()
        && match run.outcome {
            InterfaceCompilerVerificationOutcome::Success => run.failure_message.is_none(),
            InterfaceCompilerVerificationOutcome::Failure => run
                .failure_message
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty()),
        }
}

pub(super) fn conflicts_with_retained_run(
    verification: &InterfaceCompilerReplacementVerification,
    candidate: &InterfaceCompilerReplacementVerificationRun,
) -> bool {
    let retained_evidence: HashSet<&str> = verification
        .runs
        .iter()
        .flat_map(|run| run.evidence_ids.iter().map(String::as_str))
        .collect();
    verification.runs.iter().any(|run| {
        run.id == candidate.id
            || run.session_id == candidate.session_id
            || candidate
                .evidence_ids
                .iter()
                .any(|evidence| retained_evidence.contains(evidence.as_str()))
    })
}

pub(super) fn verification_admits_activation(
    verification: &InterfaceCompilerReplacementVerification,
    capability_id: &str,
    replay_id: &str,
    created_at: Option<&str>,
    verified_at: &str,
) -> bool {
    if verification.required_successful_runs != REQUIRED_REPLACEMENT_VERIFICATION_RUNS
        || verification.runs.is_empty()
    {
        return false;
    }
    let Some(created_at) = created_at else {
        return false;
    };
    let mut run_ids = HashSet::new();
    let mut session_ids = HashSet::new();
    let mut evidence_ids = HashSet::new();
    let mut successes = 0_u64;
    for run in &verification.runs {
        if !valid_verification_run(run)
            || run.capability_id != capability_id
            || run.replay_version_id != replay_id
            || !run_ids.insert(run.id.as_str())
            || !session_ids.insert(run.session_id.as_str())
            || !ordered(created_at, &run.completed_at)
            || !ordered(&run.completed_at, verified_at)
            || run
                .evidence_ids
                .iter()
                .any(|value| !evidence_ids.insert(value.as_str()))
        {
            return false;
        }
        if run.outcome == InterfaceCompilerVerificationOutcome::Success {
            successes += 1;
        }
    }
    successes >= verification.required_successful_runs
}

pub(super) fn replay_failure_from_settlement(
    settlement_json: Option<&str>,
) -> Option<(serde_json::Value, String)> {
    let settlement: serde_json::Value = serde_json::from_str(settlement_json?).ok()?;
    if settlement.get("status")?.as_str()? != "failure" {
        return None;
    }
    let completion = settlement.get("completion")?.as_object()?;
    if completion.get("kind")?.as_str()? != "failure"
        || completion.get("reason")?.as_str()? != "replay_failed"
    {
        return None;
    }
    let failure = completion.get("replayFailure")?.clone();
    let broken_at = settlement.get("endedAt")?.as_str()?.to_string();
    (valid_replay_failure(&failure) && valid_timestamp(&broken_at)).then_some((failure, broken_at))
}

pub(super) fn ordered(earlier: &str, later: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(earlier)
        .ok()
        .zip(chrono::DateTime::parse_from_rfc3339(later).ok())
        .is_some_and(|(earlier, later)| later >= earlier)
}

fn valid_replay_step(value: &serde_json::Value) -> bool {
    let Some(step) = value.as_object() else {
        return false;
    };
    match step.get("type").and_then(serde_json::Value::as_str) {
        Some("navigate") => exact_keys(step, &["type", "url"]) && non_empty(step.get("url")),
        Some("click") => exact_keys(step, &["type", "target"]) && valid_locator(step.get("target")),
        Some("fill" | "select") => {
            exact_keys(step, &["type", "target", "value"])
                && valid_locator(step.get("target"))
                && step.get("value").is_some_and(serde_json::Value::is_string)
        }
        Some("wait") => {
            exact_keys(step, &["type", "milliseconds"])
                && step
                    .get("milliseconds")
                    .and_then(serde_json::Value::as_u64)
                    .is_some_and(|value| value > 0 && valid_wire_revision(value))
        }
        Some("read") => {
            exact_keys(step, &["type", "target", "outputKey"])
                && valid_locator(step.get("target"))
                && non_empty(step.get("outputKey"))
        }
        Some("assert") => {
            exact_keys(step, &["type", "condition"])
                && step.get("condition").is_some_and(valid_condition)
        }
        _ => false,
    }
}

fn valid_locator(value: Option<&serde_json::Value>) -> bool {
    let Some(locator) = value.and_then(serde_json::Value::as_object) else {
        return false;
    };
    locator.keys().all(|key| {
        matches!(
            key.as_str(),
            "semanticDescription" | "role" | "name" | "text" | "selector"
        )
    }) && non_empty(locator.get("semanticDescription"))
        && ["role", "name", "text", "selector"]
            .iter()
            .all(|field| locator.get(*field).is_none_or(serde_json::Value::is_string))
}

fn valid_condition(value: &serde_json::Value) -> bool {
    let Some(condition) = value.as_object() else {
        return false;
    };
    match condition.get("kind").and_then(serde_json::Value::as_str) {
        Some("url_matches") => non_empty(condition.get("pattern")),
        Some("text_present") => non_empty(condition.get("text")),
        Some("interactable_present") => non_empty(condition.get("semanticDescription")),
        Some("cart_count_increased") => non_empty(condition.get("baselineKey")),
        Some("product_in_cart") => non_empty(condition.get("productRef")),
        Some("authentication_required" | "checkout_started") => true,
        Some("custom") => non_empty(condition.get("name")),
        _ => false,
    }
}

fn valid_replay_failure(value: &serde_json::Value) -> bool {
    let Some(failure) = value.as_object() else {
        return false;
    };
    let Some(kind) = failure.get("kind").and_then(serde_json::Value::as_str) else {
        return false;
    };
    let message = failure
        .get("message")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let evidence = failure
        .get("evidenceIds")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|values| {
            !values.is_empty()
                && values
                    .iter()
                    .all(|value| value.as_str().is_some_and(|value| !value.trim().is_empty()))
                && values.iter().collect::<HashSet<_>>().len() == values.len()
        });
    message
        && evidence
        && match kind {
            "step_failed" => failure
                .get("stepIndex")
                .and_then(serde_json::Value::as_u64)
                .is_some_and(valid_wire_revision),
            "postcondition_failed" => failure.get("condition").is_some_and(valid_condition),
            "verification_failed" => {
                failure
                    .get("successfulRuns")
                    .and_then(serde_json::Value::as_u64)
                    .is_some_and(valid_wire_revision)
                    && failure
                        .get("requiredSuccessfulRuns")
                        .and_then(serde_json::Value::as_u64)
                        .is_some_and(|value| value > 0 && valid_wire_revision(value))
            }
            _ => false,
        }
}

fn exact_keys(value: &serde_json::Map<String, serde_json::Value>, expected: &[&str]) -> bool {
    value.len() == expected.len() && expected.iter().all(|key| value.contains_key(*key))
}
fn non_empty(value: Option<&serde_json::Value>) -> bool {
    value
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
}
