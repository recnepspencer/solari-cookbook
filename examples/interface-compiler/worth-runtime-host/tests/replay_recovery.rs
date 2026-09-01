use std::time::Duration;

use interface_compiler_worth_runtime_host::host::*;
use serde_json::json;

const EXECUTION_ID: &str = "execution.replay-recovery-host";
const REPLACEMENT_ID: &str = "replay.trades.ingest-incoming-trade.v2";
const REPLACEMENT_EXPERIMENT_ID: &str = "experiment.recovery.ingest-incoming-trade";

#[test]
fn worth_owns_failure_degradation_exploration_verification_and_replacement_activation() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo().expect("WORTH demo host");
        let (settled_revision, failure) = settle_replay_failure(&host, EXECUTION_ID);

        let degraded = host.degrade_replay(DegradeReplayRequest {
            execution_id: EXECUTION_ID.into(),
            capability_id: DEMO_CAPABILITY_ID.into(),
            replay_version_id: DEMO_REPLAY_ID.into(),
            expected_execution_revision: settled_revision,
            expected_capability_revision: DEMO_CAPABILITY_REVISION,
            expected_replay_revision: DEMO_REPLAY_REVISION,
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(2),
        });
        let (degraded_capability, broken_replay) = applied(degraded);
        assert_eq!(degraded_capability.id, DEMO_CAPABILITY_ID);
        assert_eq!(degraded_capability.name, "TradesIngestIncomingTrade");
        assert_eq!(degraded_capability.status, "degraded");
        assert_eq!(
            degraded_capability.active_replay_id.as_deref(),
            Some(DEMO_REPLAY_ID)
        );
        assert_eq!(
            degraded_capability.broken_replay_id.as_deref(),
            Some(DEMO_REPLAY_ID)
        );
        assert_eq!(
            degraded_capability.failure_json.as_deref(),
            Some(failure.to_string().as_str())
        );
        assert_eq!(broken_replay.status, "broken");
        assert_eq!(broken_replay.revision, DEMO_REPLAY_REVISION + 1);
        assert_eq!(
            broken_replay.broken_at.as_deref(),
            Some("2026-09-01T12:00:04.000Z")
        );
        assert!(matches!(
            host.read_active_replay(InterfaceCompilerCompiledReadRequest::new(
                DEMO_CAPABILITY_ID,
                DEMO_CREDENTIAL,
                Duration::from_secs(1),
            )),
            InterfaceCompilerActiveReplayReadOutcome::Denied { .. }
        ));

        let accepted = host.accept_replacement_candidate(AcceptReplacementCandidateRequest {
            capability_id: DEMO_CAPABILITY_ID.into(),
            broken_replay_version_id: DEMO_REPLAY_ID.into(),
            expected_capability_revision: degraded_capability.revision,
            expected_broken_replay_revision: broken_replay.revision,
            candidate: replacement_candidate(DEMO_CAPABILITY_ID),
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(2),
        });
        let (verifying_capability, mut verifying_replay) = applied(accepted);
        assert_eq!(verifying_capability.id, degraded_capability.id);
        assert_eq!(verifying_capability.name, degraded_capability.name);
        assert_eq!(verifying_capability.status, "verifying");
        assert_eq!(
            verifying_capability.candidate_replay_id.as_deref(),
            Some(REPLACEMENT_ID)
        );
        assert_eq!(verifying_replay.status, "verifying");
        assert_eq!(
            verifying_replay.supersedes_id.as_deref(),
            Some(DEMO_REPLAY_ID)
        );
        assert_ne!(verifying_replay.steps_json, broken_replay.steps_json);

        for index in 1..=3 {
            let recorded =
                host.record_replacement_verification(RecordReplacementVerificationRequest {
                    capability_id: DEMO_CAPABILITY_ID.into(),
                    replay_version_id: REPLACEMENT_ID.into(),
                    expected_capability_revision: verifying_capability.revision,
                    expected_replay_revision: verifying_replay.revision,
                    run: verification_run(index),
                    credential: DEMO_CREDENTIAL.into(),
                    timeout: Duration::from_secs(2),
                });
            let (capability, replay) = applied(recorded);
            assert_eq!(capability.revision, verifying_capability.revision);
            verifying_replay = replay;
        }

        let activated = host.activate_replacement(ActivateReplacementRequest {
            capability_id: DEMO_CAPABILITY_ID.into(),
            replay_version_id: REPLACEMENT_ID.into(),
            expected_capability_revision: verifying_capability.revision,
            expected_replay_revision: verifying_replay.revision,
            verified_at: "2026-09-01T12:05:00.000Z".into(),
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(2),
        });
        let (healthy_capability, active_replay) = applied(activated);
        assert_eq!(healthy_capability.id, degraded_capability.id);
        assert_eq!(healthy_capability.name, degraded_capability.name);
        assert_eq!(healthy_capability.status, "healthy");
        assert_eq!(
            healthy_capability.active_replay_id.as_deref(),
            Some(REPLACEMENT_ID)
        );
        assert!(healthy_capability.candidate_replay_id.is_none());
        assert!(healthy_capability.broken_replay_id.is_none());
        assert!(healthy_capability.failure_json.is_none());
        assert_eq!(active_replay.status, "active");
        assert_eq!(active_replay.id, REPLACEMENT_ID);
        assert_eq!(
            active_replay.verified_at.as_deref(),
            Some("2026-09-01T12:05:00.000Z")
        );

        let current = host.read_active_replay(InterfaceCompilerCompiledReadRequest::new(
            DEMO_CAPABILITY_ID,
            DEMO_CREDENTIAL,
            Duration::from_secs(1),
        ));
        assert!(matches!(
            current,
            InterfaceCompilerActiveReplayReadOutcome::Found { projection, .. }
                if projection.id == REPLACEMENT_ID && projection.steps_json == active_replay.steps_json
        ));
        assert!(matches!(
            host.read_replay(InterfaceCompilerReplayReadRequest {
                capability_id: DEMO_CAPABILITY_ID.into(),
                replay_id: DEMO_REPLAY_ID.into(),
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(1),
            }),
            InterfaceCompilerReplayReadOutcome::Found { projection, .. }
                if projection.status == "broken"
        ));
    });
}

#[test]
fn recovery_denies_nonterminal_foreign_duplicate_insufficient_and_stale_inputs() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo().expect("WORTH demo host");
        let started_revision = admit_compiled(&host, "execution.replay-not-terminal");
        assert!(matches!(
            host.degrade_replay(DegradeReplayRequest {
                execution_id: "execution.replay-not-terminal".into(),
                capability_id: DEMO_CAPABILITY_ID.into(),
                replay_version_id: DEMO_REPLAY_ID.into(),
                expected_execution_revision: started_revision,
                expected_capability_revision: DEMO_CAPABILITY_REVISION,
                expected_replay_revision: DEMO_REPLAY_REVISION,
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            }),
            InterfaceCompilerReplayRecoveryOutcome::Denied {
                stage: InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                ..
            }
        ));

        let (settled_revision, _) = settle_replay_failure(&host, EXECUTION_ID);
        let (degraded_capability, broken_replay) =
            applied(host.degrade_replay(DegradeReplayRequest {
                execution_id: EXECUTION_ID.into(),
                capability_id: DEMO_CAPABILITY_ID.into(),
                replay_version_id: DEMO_REPLAY_ID.into(),
                expected_execution_revision: settled_revision,
                expected_capability_revision: DEMO_CAPABILITY_REVISION,
                expected_replay_revision: DEMO_REPLAY_REVISION,
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            }));
        assert!(matches!(
            host.accept_replacement_candidate(AcceptReplacementCandidateRequest {
                capability_id: DEMO_CAPABILITY_ID.into(),
                broken_replay_version_id: DEMO_REPLAY_ID.into(),
                expected_capability_revision: DEMO_CAPABILITY_REVISION,
                expected_broken_replay_revision: broken_replay.revision,
                candidate: replacement_candidate(DEMO_CAPABILITY_ID),
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            }),
            InterfaceCompilerReplayRecoveryOutcome::Stale {
                entity: InterfaceCompilerReplayRecoveryEntity::Capability,
                actual,
                ..
            } if actual == degraded_capability.revision
        ));
        assert!(matches!(
            host.accept_replacement_candidate(AcceptReplacementCandidateRequest {
                capability_id: DEMO_CAPABILITY_ID.into(),
                broken_replay_version_id: DEMO_REPLAY_ID.into(),
                expected_capability_revision: degraded_capability.revision,
                expected_broken_replay_revision: broken_replay.revision,
                candidate: replacement_candidate("capability.foreign"),
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            }),
            InterfaceCompilerReplayRecoveryOutcome::Denied {
                stage: InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                ..
            }
        ));

        let (verifying_capability, verifying_replay) = applied(host.accept_replacement_candidate(
            AcceptReplacementCandidateRequest {
                capability_id: DEMO_CAPABILITY_ID.into(),
                broken_replay_version_id: DEMO_REPLAY_ID.into(),
                expected_capability_revision: degraded_capability.revision,
                expected_broken_replay_revision: broken_replay.revision,
                candidate: replacement_candidate(DEMO_CAPABILITY_ID),
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            },
        ));
        assert!(matches!(
            host.activate_replacement(ActivateReplacementRequest {
                capability_id: DEMO_CAPABILITY_ID.into(),
                replay_version_id: REPLACEMENT_ID.into(),
                expected_capability_revision: verifying_capability.revision,
                expected_replay_revision: verifying_replay.revision,
                verified_at: "2026-09-01T12:05:00.000Z".into(),
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            }),
            InterfaceCompilerReplayRecoveryOutcome::Denied {
                stage: InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                ..
            }
        ));
        let (_, replay_after_run) = applied(host.record_replacement_verification(
            RecordReplacementVerificationRequest {
                capability_id: DEMO_CAPABILITY_ID.into(),
                replay_version_id: REPLACEMENT_ID.into(),
                expected_capability_revision: verifying_capability.revision,
                expected_replay_revision: verifying_replay.revision,
                run: verification_run(1),
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            },
        ));
        assert!(matches!(
            host.record_replacement_verification(RecordReplacementVerificationRequest {
                capability_id: DEMO_CAPABILITY_ID.into(),
                replay_version_id: REPLACEMENT_ID.into(),
                expected_capability_revision: verifying_capability.revision,
                expected_replay_revision: replay_after_run.revision,
                run: verification_run(1),
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            }),
            InterfaceCompilerReplayRecoveryOutcome::Denied {
                stage: InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                ..
            }
        ));
    });
}

#[test]
fn malformed_failure_and_candidate_contracts_are_denied_before_recovery_mutation() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo().expect("WORTH demo host");
        let started_revision = admit_compiled(&host, "execution.invalid-replay-failure");
        let settled = host.complete_execution(CompleteExecutionRequest {
            execution_id: "execution.invalid-replay-failure".into(),
            expected_revision: started_revision,
            settlement: json!({
                "status": "failure",
                "completion": {
                    "kind": "failure",
                    "reason": "replay_failed",
                    "message": "compiled replay failed",
                    "replayFailure": {
                        "kind": "postcondition_failed",
                        "condition": { "kind": "text_present", "text": "" },
                        "message": "invalid semantic condition",
                        "evidenceIds": ["evidence.invalid-failure"]
                    }
                },
                "endedAt": "2026-09-01T12:00:04.000Z"
            }),
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(2),
        });
        let settled_revision = match settled {
            SettlementOutcome::Applied { projection, .. } => projection.revision,
            other => panic!("test setup should retain the execution failure: {other:?}"),
        };
        assert!(matches!(
            host.degrade_replay(DegradeReplayRequest {
                execution_id: "execution.invalid-replay-failure".into(),
                capability_id: DEMO_CAPABILITY_ID.into(),
                replay_version_id: DEMO_REPLAY_ID.into(),
                expected_execution_revision: settled_revision,
                expected_capability_revision: DEMO_CAPABILITY_REVISION,
                expected_replay_revision: DEMO_REPLAY_REVISION,
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            }),
            InterfaceCompilerReplayRecoveryOutcome::Denied {
                stage: InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                ..
            }
        ));
        assert!(matches!(
            host.read_capability(InterfaceCompilerCompiledReadRequest::new(
                DEMO_CAPABILITY_ID,
                DEMO_CREDENTIAL,
                Duration::from_secs(1),
            )),
            InterfaceCompilerCapabilityReadOutcome::Found { projection, .. }
                if projection.status == "healthy" && projection.revision == DEMO_CAPABILITY_REVISION
        ));

        let host = InterfaceCompilerWorthHost::in_memory_demo().expect("WORTH demo host");
        let (settled_revision, _) = settle_replay_failure(&host, "execution.invalid-candidate");
        let (degraded_capability, broken_replay) =
            applied(host.degrade_replay(DegradeReplayRequest {
                execution_id: "execution.invalid-candidate".into(),
                capability_id: DEMO_CAPABILITY_ID.into(),
                replay_version_id: DEMO_REPLAY_ID.into(),
                expected_execution_revision: settled_revision,
                expected_capability_revision: DEMO_CAPABILITY_REVISION,
                expected_replay_revision: DEMO_REPLAY_REVISION,
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            }));
        let mut malformed = replacement_candidate(DEMO_CAPABILITY_ID);
        malformed.steps = vec![json!({
            "type": "assert",
            "condition": { "kind": "text_present", "text": "" }
        })];
        assert!(matches!(
            host.accept_replacement_candidate(AcceptReplacementCandidateRequest {
                capability_id: DEMO_CAPABILITY_ID.into(),
                broken_replay_version_id: DEMO_REPLAY_ID.into(),
                expected_capability_revision: degraded_capability.revision,
                expected_broken_replay_revision: broken_replay.revision,
                candidate: malformed,
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(2),
            }),
            InterfaceCompilerReplayRecoveryOutcome::Denied {
                stage: InterfaceCompilerReplayRecoveryStage::Request,
                ..
            }
        ));
        assert!(matches!(
            host.read_capability(InterfaceCompilerCompiledReadRequest::new(
                DEMO_CAPABILITY_ID,
                DEMO_CREDENTIAL,
                Duration::from_secs(1),
            )),
            InterfaceCompilerCapabilityReadOutcome::Found { projection, .. }
                if projection.status == "degraded"
                    && projection.revision == degraded_capability.revision
        ));
        assert!(matches!(
            host.read_replay(InterfaceCompilerReplayReadRequest {
                capability_id: DEMO_CAPABILITY_ID.into(),
                replay_id: REPLACEMENT_ID.into(),
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(1),
            }),
            InterfaceCompilerReplayReadOutcome::NotFound { .. }
        ));
    });
}

fn settle_replay_failure(
    host: &InterfaceCompilerWorthHost,
    execution_id: &str,
) -> (u64, serde_json::Value) {
    let started_revision = admit_compiled(host, execution_id);
    let failure = json!({
        "kind": "step_failed",
        "stepIndex": 1,
        "message": "the retained search control disappeared",
        "evidenceIds": ["evidence.replay-failure.host"]
    });
    let outcome = host.complete_execution(CompleteExecutionRequest {
        execution_id: execution_id.into(),
        expected_revision: started_revision,
        settlement: json!({
            "status": "failure",
            "completion": {
                "kind": "failure",
                "reason": "replay_failed",
                "message": "compiled replay failed",
                "replayFailure": failure
            },
            "endedAt": "2026-09-01T12:00:04.000Z"
        }),
        credential: DEMO_CREDENTIAL.into(),
        timeout: Duration::from_secs(2),
    });
    match outcome {
        SettlementOutcome::Applied { projection, .. } => (projection.revision, failure),
        other => panic!("failed execution should settle: {other:?}"),
    }
}

fn admit_compiled(host: &InterfaceCompilerWorthHost, execution_id: &str) -> u64 {
    match host.admit_execution(InterfaceCompilerStartExecutionRequest::admission(
        execution_id,
        DEMO_CAPABILITY_ID,
        Some(DEMO_REPLAY_ID.into()),
        "compiled",
        InterfaceCompilerStartMetrics::zero("2026-09-01T12:00:00.000Z"),
        DEMO_CREDENTIAL,
        Duration::from_secs(2),
    )) {
        InterfaceCompilerStartExecutionOutcome::Transitioned { projection, .. } => {
            projection.revision
        }
        other => panic!("compiled execution should be admitted: {other:?}"),
    }
}

fn replacement_candidate(capability_id: &str) -> InterfaceCompilerReplacementCandidate {
    InterfaceCompilerReplacementCandidate {
        replay_version_id: REPLACEMENT_ID.into(),
        capability_id: capability_id.into(),
        version: 2,
        steps: vec![
            json!({"type":"navigate","url":"https://interface-compiler.example/?page=mail"}),
            json!({"type":"click","target":{"semanticDescription":"deliver incoming trade","role":"button","name":"Deliver new trade email"}}),
            json!({"type":"click","target":{"semanticDescription":"post trade to Financials","role":"button","name":"Review CSV & post to Financials"}}),
        ],
        confidence: 0.875,
        discovered_from_experiment_id: REPLACEMENT_EXPERIMENT_ID.into(),
        supersedes: DEMO_REPLAY_ID.into(),
        created_at: "2026-09-01T12:01:00.000Z".into(),
    }
}

fn verification_run(index: u64) -> InterfaceCompilerReplacementVerificationRun {
    InterfaceCompilerReplacementVerificationRun {
        id: format!("verification.replacement.{index}"),
        capability_id: DEMO_CAPABILITY_ID.into(),
        replay_version_id: REPLACEMENT_ID.into(),
        session_id: format!("solari.session.replacement.{index}"),
        fresh_session: true,
        outcome: InterfaceCompilerVerificationOutcome::Success,
        failure_message: None,
        evidence_ids: vec![format!("evidence.replacement.{index}")],
        completed_at: format!("2026-09-01T12:0{}:00.000Z", index + 1),
    }
}

fn applied(
    outcome: InterfaceCompilerReplayRecoveryOutcome,
) -> (
    interface_compiler_worth_runtime_host::application::InterfaceCompilerCapabilityProjection,
    interface_compiler_worth_runtime_host::application::InterfaceCompilerActiveReplayProjection,
) {
    match outcome {
        InterfaceCompilerReplayRecoveryOutcome::Applied {
            capability,
            replay,
            capability_evidence,
            replay_evidence,
            ..
        } => {
            assert!(capability_evidence.basis_released);
            assert!(replay_evidence.basis_released);
            (capability, replay)
        }
        other => panic!("WORTH recovery operation should apply: {other:?}"),
    }
}

fn run_on_host_stack(test: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new()
        .name("worth-replay-recovery-test".into())
        .stack_size(32 * 1024 * 1024)
        .spawn(test)
        .expect("recovery test thread")
        .join()
        .expect("recovery scenario");
}
