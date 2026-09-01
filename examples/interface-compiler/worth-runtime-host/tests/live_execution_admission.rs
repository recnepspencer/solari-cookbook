use interface_compiler_worth_runtime_host::host::*;
use serde_json::json;
use std::time::Duration;

#[test]
fn arbitrary_execution_telemetry_is_projected_from_its_worth_journal() {
    std::thread::Builder::new()
        .stack_size(32 * 1024 * 1024)
        .spawn(admission_and_metrics_scenario)
        .expect("test thread")
        .join()
        .expect("scenario");
}

fn admission_and_metrics_scenario() {
    let host = InterfaceCompilerWorthHost::in_memory_demo().expect("host");
    let execution_id = "execution.caller-issued-9f6a";
    let admitted = host.admit_execution(InterfaceCompilerStartExecutionRequest::admission(
        execution_id,
        DEMO_CAPABILITY_ID,
        None,
        "direct",
        InterfaceCompilerStartMetrics::zero("2026-09-01T12:00:00.000Z"),
        DEMO_CREDENTIAL,
        Duration::from_secs(1),
    ));
    let revision = match admitted {
        InterfaceCompilerStartExecutionOutcome::Transitioned {
            projection,
            evidence,
            ..
        } => {
            assert_eq!(projection.execution_id, execution_id);
            assert_eq!(projection.capability_id, DEMO_CAPABILITY_ID);
            assert_eq!(projection.lifecycle, "started");
            assert_eq!(evidence.projected_field_count, 8);
            projection.revision
        }
        outcome => panic!("arbitrary execution should be admitted: {outcome:?}"),
    };
    let event = |id: &str, kind: &str, payload: serde_json::Value| {
        json!({
            "eventId": id, "occurredAt": "2026-09-01T12:00:01.000Z", "protocol": "interface-compiler.events",
            "schemaVersion": 1, "idempotencyKey": id, "recovery": "replay_safe",
            "integrity": { "algorithm": "sha256", "digest": "test" }, "type": kind, "payload": payload
        })
    };
    for event in [
        event(
            "event.model",
            "model.called",
            json!({"executionId": execution_id, "role":"explorer", "inputTokens":11, "outputTokens":7, "estimatedModelCostMicrocents":2_500_000}),
        ),
        event(
            "event.observe",
            "browser.observed",
            json!({"executionId": execution_id, "sessionId":"session.1", "observationId":"observation.1"}),
        ),
        event(
            "event.action",
            "browser.action",
            json!({"executionId": execution_id, "sessionId":"session.1", "actionType":"click"}),
        ),
    ] {
        let outcome = host.publish_domain_event(PublishDomainEventRequest {
            event,
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(1),
        });
        assert!(
            matches!(outcome, SettlementOutcome::Applied { .. }),
            "event publication failed: {outcome:?}"
        );
    }
    let settled = host.complete_execution(CompleteExecutionRequest {
        execution_id: execution_id.into(), expected_revision: revision,
        settlement: json!({"status":"success","completion":{"kind":"success"},"endedAt":"2026-09-01T12:00:03.500Z"}),
        credential: DEMO_CREDENTIAL.into(), timeout: Duration::from_secs(1),
    });
    match settled {
        SettlementOutcome::Applied { projection, .. } => {
            let metrics: serde_json::Value =
                serde_json::from_str(&projection.metrics_json).expect("metrics");
            assert_eq!(metrics["modelCalls"], 1);
            assert_eq!(metrics["inputTokens"], 11);
            assert_eq!(metrics["outputTokens"], 7);
            assert_eq!(metrics["browserObservations"], 1);
            assert_eq!(metrics["browserActions"], 1);
            assert_eq!(metrics["estimatedModelCostMicrocents"], 2_500_000);
            assert_eq!(metrics["wallClockMs"], 3500);
        }
        outcome => panic!("execution should settle with authoritative metrics: {outcome:?}"),
    }
    let terminal = event(
        "event.completed",
        "direct.completed",
        json!({"executionId": execution_id, "outcome": "success"}),
    );
    assert!(
        matches!(
            host.publish_domain_event(PublishDomainEventRequest {
                event: terminal,
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(1),
            }),
            SettlementOutcome::Applied { .. }
        ),
        "terminal event should be retained after settlement"
    );
}

#[test]
fn telemetry_and_terminal_time_fail_closed_without_mutating_execution() {
    std::thread::Builder::new()
        .stack_size(32 * 1024 * 1024)
        .spawn(telemetry_and_terminal_guard_scenario)
        .expect("test thread")
        .join()
        .expect("scenario");
}

fn telemetry_and_terminal_guard_scenario() {
    let host = InterfaceCompilerWorthHost::in_memory_demo().expect("host");
    let execution_id = "execution.temporal-guard";
    let admitted = host.admit_execution(InterfaceCompilerStartExecutionRequest::admission(
        execution_id,
        DEMO_CAPABILITY_ID,
        None,
        "direct",
        InterfaceCompilerStartMetrics::zero("2026-09-01T12:00:00.000Z"),
        DEMO_CREDENTIAL,
        Duration::from_secs(1),
    ));
    let revision = match admitted {
        InterfaceCompilerStartExecutionOutcome::Transitioned { projection, .. } => {
            projection.revision
        }
        outcome => panic!("execution should be admitted: {outcome:?}"),
    };
    let fractional_microcent = json!({
        "eventId":"event.fractional-microcent", "occurredAt":"2026-09-01T12:00:01.000Z",
        "protocol":"interface-compiler.events", "schemaVersion":1,
        "idempotencyKey":"event.fractional-microcent", "recovery":"replay_safe",
        "integrity":{"algorithm":"sha256","digest":"test"}, "type":"model.called",
        "payload":{"executionId":execution_id,"role":"explorer","inputTokens":1,"outputTokens":1,"estimatedModelCostMicrocents":0.5}
    });
    assert!(matches!(
        host.publish_domain_event(PublishDomainEventRequest {
            event: fractional_microcent,
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(1),
        }),
        SettlementOutcome::Denied { .. }
    ));
    let unknown_event = json!({
        "eventId":"event.unknown", "occurredAt":"2026-09-01T12:00:01.000Z",
        "protocol":"interface-compiler.events", "schemaVersion":1,
        "idempotencyKey":"event.unknown", "recovery":"replay_safe",
        "integrity":{"algorithm":"sha256","digest":"test"}, "type":"model.called",
        "payload":{"executionId":"execution.not-admitted","role":"explorer","inputTokens":1,"outputTokens":1,"estimatedModelCostMicrocents":1000000}
    });
    assert!(matches!(
        host.publish_domain_event(PublishDomainEventRequest {
            event: unknown_event,
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(1),
        }),
        SettlementOutcome::Denied { .. }
    ));
    assert!(matches!(
        host.complete_execution(CompleteExecutionRequest {
            execution_id: execution_id.into(),
            expected_revision: revision,
            settlement: json!({"status":"success","completion":{"kind":"success"},"endedAt":"2026-09-01T11:59:59.000Z"}),
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(1),
        }),
        SettlementOutcome::Denied { .. }
    ));
    assert!(matches!(
        host.complete_execution(CompleteExecutionRequest {
            execution_id: execution_id.into(),
            expected_revision: revision,
            settlement: json!({"status":"success","completion":{"kind":"success"},"endedAt":"2026-09-01T12:00:02.000Z"}),
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(1),
        }),
        SettlementOutcome::Applied { .. }
    ));
}

#[test]
fn arbitrary_execution_admission_fails_closed_for_duplicates_and_ineligible_inputs() {
    let host = InterfaceCompilerWorthHost::in_memory_demo().expect("host");
    let request = || {
        InterfaceCompilerStartExecutionRequest::admission(
            "execution.duplicate-live",
            DEMO_CAPABILITY_ID,
            None,
            "direct",
            InterfaceCompilerStartMetrics::zero("2026-09-01T12:00:00.000Z"),
            DEMO_CREDENTIAL,
            Duration::from_secs(1),
        )
    };
    assert!(matches!(
        host.admit_execution(request()),
        InterfaceCompilerStartExecutionOutcome::Transitioned { .. }
    ));
    assert!(matches!(
        host.admit_execution(request()),
        InterfaceCompilerStartExecutionOutcome::LifecycleNotPending { .. }
    ));
    let malformed = InterfaceCompilerStartExecutionRequest::admission(
        "bad",
        DEMO_CAPABILITY_ID,
        None,
        "direct",
        InterfaceCompilerStartMetrics::zero("2026-09-01T12:00:00.000Z"),
        DEMO_CREDENTIAL,
        Duration::from_secs(1),
    );
    assert!(matches!(
        host.admit_execution(malformed),
        InterfaceCompilerStartExecutionOutcome::Denied {
            stage: InterfaceCompilerStartExecutionDenialStage::Request,
            ..
        }
    ));
    let malformed_time = InterfaceCompilerStartExecutionRequest::admission(
        "execution.malformed-time",
        DEMO_CAPABILITY_ID,
        None,
        "direct",
        InterfaceCompilerStartMetrics::zero("not-a-timestamp"),
        DEMO_CREDENTIAL,
        Duration::from_secs(1),
    );
    assert!(matches!(
        host.admit_execution(malformed_time),
        InterfaceCompilerStartExecutionOutcome::Denied { .. }
    ));
}
