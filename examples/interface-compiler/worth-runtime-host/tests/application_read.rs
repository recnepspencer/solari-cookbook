use std::time::Duration;

use interface_compiler_worth_runtime_host::host::{
    InterfaceCompilerApplicationReadDenial, InterfaceCompilerApplicationReadOutcome,
    InterfaceCompilerApplicationReadRequest, InterfaceCompilerWorthHost, DEFAULT_REQUEST_TIMEOUT,
    DEMO_APPLICATION_BASE_URL, DEMO_APPLICATION_ID, DEMO_APPLICATION_NAME,
    DEMO_APPLICATION_REVISION, DEMO_CREDENTIAL,
};
use interface_compiler_worth_runtime_host::protocol::{
    handle_request, InterfaceCompilerHostRequest, InterfaceCompilerHostResponse,
    InterfaceCompilerHostUnavailableReason, INTERFACE_COMPILER_WORTH_PROTOCOL,
};

#[test]
fn public_facade_host_executes_the_admitted_application_query() {
    let host = InterfaceCompilerWorthHost::in_memory_demo()
        .expect("the public WORTH host facade should publish the demo runtime");
    let outcome = host.read_application(InterfaceCompilerApplicationReadRequest::new(
        DEMO_APPLICATION_ID,
        DEMO_CREDENTIAL,
        DEFAULT_REQUEST_TIMEOUT,
    ));

    let InterfaceCompilerApplicationReadOutcome::Found {
        projection,
        evidence,
    } = outcome
    else {
        panic!("the admitted WORTH application query should return a projection");
    };
    assert_eq!(projection.id, DEMO_APPLICATION_ID);
    assert_eq!(projection.revision, DEMO_APPLICATION_REVISION);
    assert_eq!(projection.name, DEMO_APPLICATION_NAME);
    assert_eq!(projection.base_url, DEMO_APPLICATION_BASE_URL);
    assert_eq!(evidence.query_name, "interface_compiler_application_read");
    assert!(!evidence.query_identity.is_empty());
    assert_eq!(evidence.projected_record_count, 1);
    assert_eq!(evidence.projected_field_count, 4);
    assert_ne!(evidence.basis_version, projection.revision);
    assert!(evidence.basis_released);
}

#[test]
fn authentication_and_unknown_application_are_worth_typed_outcomes() {
    let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
    let denied = host.read_application(InterfaceCompilerApplicationReadRequest::new(
        DEMO_APPLICATION_ID,
        "wrong-demo-credential",
        DEFAULT_REQUEST_TIMEOUT,
    ));
    assert!(matches!(
        denied,
        InterfaceCompilerApplicationReadOutcome::Denied {
            denial: InterfaceCompilerApplicationReadDenial::Authentication(_),
            ..
        }
    ));

    let missing = host.read_application(InterfaceCompilerApplicationReadRequest::new(
        "application.unknown",
        DEMO_CREDENTIAL,
        DEFAULT_REQUEST_TIMEOUT,
    ));
    assert!(matches!(
        missing,
        InterfaceCompilerApplicationReadOutcome::NotFound { application_id }
            if application_id == "application.unknown"
    ));
}

#[test]
fn unsupported_operations_are_explicitly_unavailable() {
    let host = InterfaceCompilerWorthHost::in_memory_demo().unwrap();
    let response = handle_request(
        InterfaceCompilerHostRequest {
            protocol: INTERFACE_COMPILER_WORTH_PROTOCOL.to_string(),
            request_id: "unsupported-1".to_string(),
            operation: "submit_lifecycle_command".to_string(),
            application_id: None,
            execution_id: None,
            capability_id: None,
            credential: None,
            deadline_ms: Some(Duration::from_secs(1).as_millis() as u64),
        },
        &host,
    );
    assert!(matches!(
        response,
        InterfaceCompilerHostResponse::Unavailable {
            reason: InterfaceCompilerHostUnavailableReason::Unsupported,
            ..
        }
    ));
}
