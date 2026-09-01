use super::{
    valid_identity, valid_timestamp, valid_wire_revision, AcceptReplacementCandidateRequest,
    MAX_RECOVERY_JSON_BYTES,
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

pub(super) fn valid_condition(value: &serde_json::Value) -> bool {
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

fn exact_keys(value: &serde_json::Map<String, serde_json::Value>, expected: &[&str]) -> bool {
    value.len() == expected.len() && expected.iter().all(|key| value.contains_key(*key))
}

fn non_empty(value: Option<&serde_json::Value>) -> bool {
    value
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
}
