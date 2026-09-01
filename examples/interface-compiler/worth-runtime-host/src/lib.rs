//! Real, deliberately narrow WORTH Query host for the Interface Compiler demo.
//!
//! The public library surface is the app-specific host and its typed process
//! protocol.  The implementation enters WORTH only through
//! `worth_query_host::facade`; no lower-level WORTH crate is a dependency of
//! this package.

pub mod application;
pub mod host;
pub mod protocol;

pub use host::{
    CompleteExecutionRequest, InterfaceCompilerApplicationReadDenial,
    InterfaceCompilerApplicationReadEvidence, InterfaceCompilerApplicationReadInvalidRequest,
    InterfaceCompilerApplicationReadOutcome, InterfaceCompilerApplicationReadRequest,
    InterfaceCompilerExecutionCommitKind, InterfaceCompilerExecutionQueryEvidence,
    InterfaceCompilerHostSetupError, InterfaceCompilerStartExecutionDenialStage,
    InterfaceCompilerStartExecutionOutcome, InterfaceCompilerStartExecutionRequest,
    InterfaceCompilerWorthHost, PublishDomainEventRequest, SettlementOutcome,
    DEMO_APPLICATION_REVISION, DEMO_CREDENTIAL, DEMO_EXECUTION_ID, DEMO_EXECUTION_ID_TWO,
};
pub use protocol::{
    handle_request, InterfaceCompilerHostRequest, InterfaceCompilerHostResponse,
    COMPLETE_EXECUTION_OPERATION, INTERFACE_COMPILER_WORTH_PROTOCOL,
    PUBLISH_DOMAIN_EVENT_OPERATION, READ_APPLICATION_OPERATION, START_EXECUTION_OPERATION,
};
