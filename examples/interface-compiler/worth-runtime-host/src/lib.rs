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
    AcceptReplacementCandidateRequest, ActivateReplacementRequest, CompleteExecutionRequest,
    DegradeReplayRequest, InterfaceCompilerApplicationReadDenial,
    InterfaceCompilerApplicationReadEvidence, InterfaceCompilerApplicationReadInvalidRequest,
    InterfaceCompilerApplicationReadOutcome, InterfaceCompilerApplicationReadRequest,
    InterfaceCompilerExecutionCommitKind, InterfaceCompilerExecutionQueryEvidence,
    InterfaceCompilerHostSetupError, InterfaceCompilerReplacementCandidate,
    InterfaceCompilerReplacementVerification, InterfaceCompilerReplacementVerificationRun,
    InterfaceCompilerReplayRecoveryEntity, InterfaceCompilerReplayRecoveryOutcome,
    InterfaceCompilerReplayRecoveryStage, InterfaceCompilerStartExecutionDenialStage,
    InterfaceCompilerStartExecutionOutcome, InterfaceCompilerStartExecutionRequest,
    InterfaceCompilerVerificationEvidence, InterfaceCompilerVerificationOutcome,
    InterfaceCompilerWorthHost, PublishDomainEventRequest, RecordReplacementVerificationRequest,
    RegisterVerificationEvidenceRequest, SettlementOutcome, DEMO_APPLICATION_REVISION,
    DEMO_CREDENTIAL, DEMO_EXECUTION_ID, DEMO_EXECUTION_ID_TWO,
    REQUIRED_REPLACEMENT_VERIFICATION_RUNS,
};
pub use protocol::{
    handle_request, InterfaceCompilerHostRequest, InterfaceCompilerHostResponse,
    ACCEPT_REPLACEMENT_CANDIDATE_OPERATION, ACTIVATE_REPLACEMENT_OPERATION,
    ADMIT_EXECUTION_OPERATION, COMPLETE_EXECUTION_OPERATION, DEGRADE_REPLAY_OPERATION,
    INTERFACE_COMPILER_WORTH_PROTOCOL, PUBLISH_DOMAIN_EVENT_OPERATION,
    READ_ACTIVE_REPLAY_OPERATION, READ_APPLICATION_OPERATION, READ_CAPABILITY_OPERATION,
    READ_RECOVERY_PROJECTION_OPERATION, RECORD_REPLACEMENT_VERIFICATION_OPERATION,
    REGISTER_VERIFICATION_EVIDENCE_OPERATION, START_EXECUTION_OPERATION,
};
