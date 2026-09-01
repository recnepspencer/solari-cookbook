use interface_compiler_worth_runtime_host::host::{
    InterfaceCompilerExecutionCommitKind, InterfaceCompilerStartExecutionOutcome,
    InterfaceCompilerStartExecutionRequest, InterfaceCompilerWorthHost, DEFAULT_REQUEST_TIMEOUT,
    DEMO_CREDENTIAL, DEMO_EXECUTION_ID, DEMO_EXECUTION_ID_TWO, DEMO_EXECUTION_NON_PENDING_ID,
    DEMO_EXECUTION_STARTED,
};
use interface_compiler_worth_runtime_host::protocol::{
    handle_request, InterfaceCompilerHostRequest, InterfaceCompilerHostResponse,
    INTERFACE_COMPILER_WORTH_PROTOCOL, START_EXECUTION_OPERATION,
};

#[test]
fn start_execution_commits_through_worth_and_returns_the_typed_query_projection() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo()
            .expect("the public WORTH host facade should publish the demonstration runtime");

        let outcome = host.start_execution(InterfaceCompilerStartExecutionRequest::new(
            DEMO_EXECUTION_ID,
            DEMO_CREDENTIAL,
            DEFAULT_REQUEST_TIMEOUT,
        ));

        let InterfaceCompilerStartExecutionOutcome::Transitioned {
            commit,
            projection,
            evidence,
        } = outcome
        else {
            panic!("the admitted start operation should commit and query through WORTH");
        };
        assert_eq!(commit, InterfaceCompilerExecutionCommitKind::Committed);
        assert_eq!(projection.execution_id, DEMO_EXECUTION_ID);
        assert_eq!(projection.lifecycle, DEMO_EXECUTION_STARTED);
        assert_eq!(evidence.query_name, "interface_compiler_execution_read");
        assert!(!evidence.query_identity.is_empty());
        assert_eq!(evidence.projected_record_count, 1);
        assert_eq!(evidence.projected_field_count, 4);
        assert!(evidence.basis_released);

        // No measured telemetry, tokens, costs, results, or fabricated metrics are
        // part of this deliberately lifecycle-only demonstration projection.
    });
}

#[test]
fn started_execution_is_rejected_without_a_second_commit() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
        let request = || {
            InterfaceCompilerStartExecutionRequest::new(
                DEMO_EXECUTION_ID,
                DEMO_CREDENTIAL,
                DEFAULT_REQUEST_TIMEOUT,
            )
        };

        let first_basis = match host.start_execution(request()) {
            InterfaceCompilerStartExecutionOutcome::Transitioned {
                commit: InterfaceCompilerExecutionCommitKind::Committed,
                evidence,
                ..
            } => evidence.basis_version,
            outcome => panic!("pending execution should commit once, got {outcome:?}"),
        };

        assert!(matches!(
            host.start_execution(request()),
            InterfaceCompilerStartExecutionOutcome::LifecycleNotPending {
                execution_id,
                current_lifecycle,
            } if execution_id == DEMO_EXECUTION_ID
                && current_lifecycle == DEMO_EXECUTION_STARTED
        ));

        let next = host.start_execution(InterfaceCompilerStartExecutionRequest::new(
            DEMO_EXECUTION_ID_TWO,
            DEMO_CREDENTIAL,
            DEFAULT_REQUEST_TIMEOUT,
        ));
        assert!(matches!(
            next,
            InterfaceCompilerStartExecutionOutcome::Transitioned {
                commit: InterfaceCompilerExecutionCommitKind::Committed,
                projection,
                evidence,
                ..
            } if projection.execution_id == DEMO_EXECUTION_ID_TWO
                && projection.lifecycle == DEMO_EXECUTION_STARTED
                && evidence.basis_version == first_basis + 1
        ));
    });
}

#[test]
fn independently_seeded_started_execution_is_rejected_without_committing() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
        let request = || {
            InterfaceCompilerStartExecutionRequest::new(
                DEMO_EXECUTION_NON_PENDING_ID,
                DEMO_CREDENTIAL,
                DEFAULT_REQUEST_TIMEOUT,
            )
        };

        for outcome in [
            host.start_execution(request()),
            host.start_execution(request()),
        ] {
            assert!(matches!(
                outcome,
                InterfaceCompilerStartExecutionOutcome::LifecycleNotPending {
                    execution_id,
                    current_lifecycle,
                } if execution_id == DEMO_EXECUTION_NON_PENDING_ID
                    && current_lifecycle == DEMO_EXECUTION_STARTED
            ));
        }
    });
}

#[test]
fn process_protocol_maps_the_real_start_transition_and_lifecycle_rejection() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
        let request = |request_id: &str, execution_id: &str| InterfaceCompilerHostRequest {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL.to_string(),
            request_id: request_id.to_string(),
            operation: START_EXECUTION_OPERATION.to_string(),
            application_id: None,
            execution_id: Some(execution_id.to_string()),
            capability_id: None,
            credential: Some(DEMO_CREDENTIAL.to_string()),
            deadline_ms: Some(DEFAULT_REQUEST_TIMEOUT.as_millis() as u64),
            expected_revision: None,
            settlement: None,
            event: None,
            ..Default::default()
        };

        assert!(matches!(
            handle_request(request("start-1", DEMO_EXECUTION_ID), &host),
            InterfaceCompilerHostResponse::ExecutionTransitioned { execution, evidence, .. }
                if execution.execution_id == DEMO_EXECUTION_ID
                    && execution.lifecycle == DEMO_EXECUTION_STARTED
                    && evidence.basis_released
        ));
        assert!(matches!(
            handle_request(request("start-2", DEMO_EXECUTION_NON_PENDING_ID), &host),
            InterfaceCompilerHostResponse::LifecycleNotPending { execution_id, current_lifecycle, .. }
                if execution_id == DEMO_EXECUTION_NON_PENDING_ID
                    && current_lifecycle == DEMO_EXECUTION_STARTED
        ));
    });
}

fn run_on_host_stack(test: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new()
        .name("worth-execution-lifecycle-test".to_string())
        .stack_size(16 * 1024 * 1024)
        .spawn(test)
        .expect("the focused WORTH test thread should start")
        .join()
        .expect("the focused WORTH test thread should complete");
}
