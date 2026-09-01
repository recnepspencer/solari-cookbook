use interface_compiler_worth_runtime_host::host::{
    InterfaceCompilerExecutionCommitKind, InterfaceCompilerStartExecutionOutcome,
    InterfaceCompilerStartExecutionRequest, InterfaceCompilerWorthHost, DEFAULT_REQUEST_TIMEOUT,
    DEMO_CREDENTIAL, DEMO_EXECUTION_COMPLETED, DEMO_EXECUTION_ID, DEMO_EXECUTION_ID_TWO,
    DEMO_EXECUTION_NON_PENDING_ID, DEMO_EXECUTION_STARTED,
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
        assert_eq!(evidence.projected_field_count, 2);
        assert!(evidence.basis_released);

        // No measured telemetry, tokens, costs, results, or fabricated metrics are
        // part of this deliberately lifecycle-only demonstration projection.
    });
}

#[test]
fn distinct_executions_commit_independently_and_retry_recovers_its_worth_commit() {
    run_on_host_stack(|| {
        let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
        let request = || {
            InterfaceCompilerStartExecutionRequest::new(
                DEMO_EXECUTION_ID,
                DEMO_CREDENTIAL,
                DEFAULT_REQUEST_TIMEOUT,
            )
        };

        assert!(matches!(
            host.start_execution(request()),
            InterfaceCompilerStartExecutionOutcome::Transitioned {
                commit: InterfaceCompilerExecutionCommitKind::Committed,
                ..
            }
        ));
        assert!(matches!(
            host.start_execution(InterfaceCompilerStartExecutionRequest::new(
                DEMO_EXECUTION_ID_TWO,
                DEMO_CREDENTIAL,
                DEFAULT_REQUEST_TIMEOUT,
            )),
            InterfaceCompilerStartExecutionOutcome::Transitioned {
                commit: InterfaceCompilerExecutionCommitKind::Committed,
                projection,
                ..
            } if projection.execution_id == DEMO_EXECUTION_ID_TWO
                && projection.lifecycle == DEMO_EXECUTION_STARTED
        ));
        let retry = host.start_execution(request());

        assert!(matches!(
            retry,
            InterfaceCompilerStartExecutionOutcome::Transitioned {
                commit: InterfaceCompilerExecutionCommitKind::AlreadyCommitted,
                projection,
                ..
            } if projection.lifecycle == DEMO_EXECUTION_STARTED
        ));
    });
}

#[test]
fn authoritative_non_pending_lifecycle_is_denied_without_changing_or_committing() {
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
                    && current_lifecycle == DEMO_EXECUTION_COMPLETED
            ));
        }
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
