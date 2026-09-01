use std::collections::HashSet;

use super::{candidate_contract::valid_condition, valid_timestamp, valid_wire_revision};

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

pub(super) fn valid_replay_failure(value: &serde_json::Value) -> bool {
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
