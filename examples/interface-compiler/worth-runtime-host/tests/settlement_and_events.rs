use interface_compiler_worth_runtime_host::host::DEMO_EXECUTION_NON_PENDING_ID;
use interface_compiler_worth_runtime_host::{
    CompleteExecutionRequest, InterfaceCompilerWorthHost, PublishDomainEventRequest,
    SettlementOutcome, DEMO_CREDENTIAL, DEMO_EXECUTION_ID, DEMO_EXECUTION_ID_TWO,
};
use serde_json::json;
use std::time::Duration;

#[test]
fn completion_is_authoritative_and_stale_requests_fail_closed() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
        let settlement = json!({"status":"success","completion":{"kind":"success","output":{"ok":true}},"endedAt":"2026-09-01T12:00:00.000Z"});
        let applied = host.complete_execution(CompleteExecutionRequest {
            execution_id: DEMO_EXECUTION_NON_PENDING_ID.into(),
            expected_revision: 1,
            settlement: settlement.clone(),
            credential: DEMO_CREDENTIAL.into(),
            timeout: Duration::from_secs(1),
        });
        match applied {
            SettlementOutcome::Applied {
                projection,
                evidence,
                ..
            } => {
                assert_eq!(projection.lifecycle, "success");
                assert_eq!(projection.revision, 2);
                assert_eq!(projection.settlement_json, settlement.to_string());
                assert_eq!(evidence.projected_record_count, 1)
            }
            other => panic!("unexpected completion: {other:?}"),
        }
        assert!(matches!(host.complete_execution(CompleteExecutionRequest{execution_id:DEMO_EXECUTION_NON_PENDING_ID.into(),expected_revision:0,settlement:json!({"status":"failure","completion":{"kind":"failure"},"endedAt":"2026-09-01T12:00:00.000Z"}),credential:DEMO_CREDENTIAL.into(),timeout:Duration::from_secs(1)}),SettlementOutcome::Stale{actual:2,..}));
        assert!(matches!(host.complete_execution(CompleteExecutionRequest{execution_id:DEMO_EXECUTION_NON_PENDING_ID.into(),expected_revision:1,settlement:settlement.clone(),credential:DEMO_CREDENTIAL.into(),timeout:Duration::from_secs(1)}),SettlementOutcome::Applied{commit:interface_compiler_worth_runtime_host::host::InterfaceCompilerExecutionCommitKind::AlreadyCommitted,..}));
        assert!(matches!(host.complete_execution(CompleteExecutionRequest{execution_id:DEMO_EXECUTION_ID_TWO.into(),expected_revision:0,settlement:json!({"status":"success","completion":{"kind":"success"},"endedAt":"2026-09-01T12:00:00.000Z"}),credential:DEMO_CREDENTIAL.into(),timeout:Duration::from_secs(1)}),SettlementOutcome::InvalidLifecycle{..}));
    });
}

#[test]
fn concrete_domain_events_are_retained_by_worth_and_retry_safely() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
        let event = json!({"eventId":"event.demo.1","occurredAt":"2026-09-01T12:00:00.000Z","protocol":"interface-compiler.events","schemaVersion":1,"idempotencyKey":"compiled.started:execution.demonstration-001","recovery":"replay_safe","integrity":{"algorithm":"sha256","digest":"abc"},"type":"compiled.started","payload":{"executionId":DEMO_EXECUTION_ID,"mode":"compiled"}});
        for expected_commit in ["committed", "already"] {
            let result = host.publish_domain_event(PublishDomainEventRequest {
                event: event.clone(),
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(1),
            });
            match result {
                SettlementOutcome::Applied {
                    commit,
                    projection,
                    evidence,
                } => {
                    assert!(projection.events_json.contains("event.demo.1"));
                    assert_eq!(projection.revision, 1);
                    assert_eq!(evidence.query_name, "interface_compiler_event_journal_read");
                    if expected_commit == "already" {
                        assert!(format!("{commit:?}").contains("Already"))
                    }
                }
                other => panic!("unexpected publication: {other:?}"),
            }
        }
        let mut changed = event.clone();
        changed["type"] = json!("direct.started");
        assert!(matches!(
            host.publish_domain_event(PublishDomainEventRequest {
                event: changed,
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(1)
            }),
            SettlementOutcome::Denied { .. }
        ));
        let mut reused_key = event.clone();
        reused_key["eventId"] = json!("event.demo.2");
        assert!(matches!(
            host.publish_domain_event(PublishDomainEventRequest {
                event: reused_key,
                credential: DEMO_CREDENTIAL.into(),
                timeout: Duration::from_secs(1)
            }),
            SettlementOutcome::Denied { .. }
        ));
    });
}

fn run_on_host_stack(test: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(test)
        .unwrap()
        .join()
        .unwrap();
}
