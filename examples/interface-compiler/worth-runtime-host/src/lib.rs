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
    InterfaceCompilerApplicationReadDenial, InterfaceCompilerApplicationReadEvidence,
    InterfaceCompilerApplicationReadInvalidRequest, InterfaceCompilerApplicationReadOutcome,
    InterfaceCompilerApplicationReadRequest, InterfaceCompilerHostSetupError,
    InterfaceCompilerWorthHost, DEMO_APPLICATION_REVISION,
};
pub use protocol::{
    handle_request, InterfaceCompilerHostRequest, InterfaceCompilerHostResponse,
    INTERFACE_COMPILER_WORTH_PROTOCOL,
};
