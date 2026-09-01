use interface_compiler_worth_runtime_host::host::{
    InterfaceCompilerActiveReplayReadOutcome, InterfaceCompilerCapabilityReadOutcome,
    InterfaceCompilerCompiledReadRequest, InterfaceCompilerWorthHost, DEFAULT_REQUEST_TIMEOUT,
    DEMO_CAPABILITY_ID, DEMO_CREDENTIAL, DEMO_REPLAY_ID,
};

#[test]
fn seeded_capability_and_active_replay_are_matching_worth_query_projections() {
    let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
    let capability = host.read_capability(InterfaceCompilerCompiledReadRequest::new(
        DEMO_CAPABILITY_ID,
        DEMO_CREDENTIAL,
        DEFAULT_REQUEST_TIMEOUT,
    ));
    let replay = host.read_active_replay(InterfaceCompilerCompiledReadRequest::new(
        DEMO_CAPABILITY_ID,
        DEMO_CREDENTIAL,
        DEFAULT_REQUEST_TIMEOUT,
    ));
    let InterfaceCompilerCapabilityReadOutcome::Found {
        projection: capability,
        evidence: capability_evidence,
    } = capability
    else {
        panic!("capability should be projected")
    };
    let InterfaceCompilerActiveReplayReadOutcome::Found {
        projection: replay,
        evidence: replay_evidence,
    } = replay
    else {
        panic!("active replay should be projected: {replay:?}")
    };
    assert_eq!(capability.status, "healthy");
    assert_eq!(capability.active_replay_id, DEMO_REPLAY_ID);
    assert_eq!(replay.status, "active");
    assert_eq!(replay.id, capability.active_replay_id);
    assert_eq!(replay.capability_id, capability.id);
    assert_eq!(capability_evidence.projected_field_count, 7);
    assert_eq!(replay_evidence.projected_field_count, 10);
    assert!(capability_evidence.basis_released && replay_evidence.basis_released);
}

#[test]
fn unknown_capability_is_not_inferred_from_replay_or_application_identity() {
    let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
    for outcome in [
        host.read_capability(InterfaceCompilerCompiledReadRequest::new(
            "capability.unknown",
            DEMO_CREDENTIAL,
            DEFAULT_REQUEST_TIMEOUT,
        )),
        host.read_capability(InterfaceCompilerCompiledReadRequest::new(
            DEMO_REPLAY_ID,
            DEMO_CREDENTIAL,
            DEFAULT_REQUEST_TIMEOUT,
        )),
    ] {
        assert!(matches!(
            outcome,
            InterfaceCompilerCapabilityReadOutcome::NotFound { .. }
        ));
    }
}
