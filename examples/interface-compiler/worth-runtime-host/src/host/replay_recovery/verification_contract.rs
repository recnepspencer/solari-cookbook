use std::collections::HashSet;

use super::{
    valid_external_identity, valid_identity, valid_timestamp, valid_wire_revision,
    InterfaceCompilerReplacementVerification, InterfaceCompilerReplacementVerificationRun,
    InterfaceCompilerVerificationOutcome, REQUIRED_REPLACEMENT_VERIFICATION_RUNS,
};

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

pub(super) fn ordered(earlier: &str, later: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(earlier)
        .ok()
        .zip(chrono::DateTime::parse_from_rfc3339(later).ok())
        .is_some_and(|(earlier, later)| later >= earlier)
}
