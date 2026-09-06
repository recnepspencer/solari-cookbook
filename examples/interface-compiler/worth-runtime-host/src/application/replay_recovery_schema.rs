//! Typed replay-recovery fields and application operations.
//!
//! These declarations keep capability, replay, verification, and promotion
//! meaning inside the WORTH application schema. The process adapter carries
//! only command inputs and published projections.

use worth_query_host::facade::declaration;
use worth_query_host::facade::{
    worth_query_field, worth_query_operation, worth_query_operation_reads,
    worth_query_operation_writes, worth_query_portable_type,
};

use super::schema::*;

worth_query_field!(
    pub CapabilityCandidateReplayIdentifier in InterfaceCompilerSchema, Capability, CapabilityFacts:
    optional String, read_write, equality
);
worth_query_field!(
    pub CapabilityBrokenReplayIdentifier in InterfaceCompilerSchema, Capability, CapabilityFacts:
    optional String, read_write, equality
);
worth_query_field!(
    pub CapabilityFailureJson in InterfaceCompilerSchema, Capability, CapabilityFacts:
    optional String, read_write, no_equality
);
worth_query_field!(
    pub ReplayDiscoveredFromExperimentIdentifier in InterfaceCompilerSchema, Replay, ReplayFacts:
    String, read_only, equality
);
worth_query_field!(
    pub ReplaySupersedesIdentifier in InterfaceCompilerSchema, Replay, ReplayFacts:
    optional String, read_write, equality
);
worth_query_field!(
    pub ReplayFailureJson in InterfaceCompilerSchema, Replay, ReplayFacts:
    optional String, read_write, no_equality
);
worth_query_field!(
    pub ReplayBrokenAt in InterfaceCompilerSchema, Replay, ReplayFacts:
    optional String, read_write, equality
);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegisterVerificationEvidenceInput {
    pub capability_id: String,
    pub replay_version_id: String,
    pub expected_capability_revision: u64,
    pub expected_replay_revision: u64,
    pub evidence_json: String,
}
worth_query_portable_type!(RegisterVerificationEvidenceInput => "interface-compiler.worth.register-verification-evidence.input.v1");
worth_query_operation!(pub RegisterVerificationEvidence(RegisterVerificationEvidenceInput) in InterfaceCompilerSchema);
worth_query_operation_reads!(RegisterVerificationEvidence => [
    CapabilityIdentifier,
    CapabilityRevision,
    CapabilityStatus,
    CapabilityActiveReplayIdentifier,
    CapabilityCandidateReplayIdentifier,
    ReplayIdentifier,
    ReplayRevision,
    ReplayCapabilityIdentifier,
    ReplayStatus,
    ReplayVerificationJson
]);
worth_query_operation_writes!(RegisterVerificationEvidence => [
    ReplayRevision,
    ReplayVerificationJson
]);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DegradeReplayInput {
    pub execution_id: String,
    pub capability_id: String,
    pub replay_version_id: String,
    pub expected_execution_revision: u64,
    pub expected_capability_revision: u64,
    pub expected_replay_revision: u64,
}
worth_query_portable_type!(DegradeReplayInput => "interface-compiler.worth.degrade-replay.input.v1");
worth_query_operation!(pub DegradeReplay(DegradeReplayInput) in InterfaceCompilerSchema);
worth_query_operation_reads!(DegradeReplay => [
    ExecutionIdentifier,
    ExecutionLifecycle,
    ExecutionRevision,
    ExecutionSettlementJson,
    ExecutionCapabilityIdentifier,
    ExecutionReplayIdentifier,
    CapabilityIdentifier,
    CapabilityRevision,
    CapabilityStatus,
    CapabilityActiveReplayIdentifier,
    CapabilityBrokenReplayIdentifier,
    CapabilityFailureJson,
    ReplayIdentifier,
    ReplayRevision,
    ReplayCapabilityIdentifier,
    ReplayStatus,
    ReplayVerificationJson,
    ReplayFailureJson,
    ReplayBrokenAt
]);
worth_query_operation_writes!(DegradeReplay => [
    CapabilityRevision,
    CapabilityStatus,
    CapabilityBrokenReplayIdentifier,
    CapabilityFailureJson,
    ReplayRevision,
    ReplayStatus,
    ReplayFailureJson,
    ReplayBrokenAt
]);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptReplacementCandidateInput {
    pub capability_id: String,
    pub broken_replay_version_id: String,
    pub candidate_replay_version_id: String,
    pub expected_capability_revision: u64,
    pub expected_broken_replay_revision: u64,
    pub candidate_json: String,
}
worth_query_portable_type!(AcceptReplacementCandidateInput => "interface-compiler.worth.accept-replacement-candidate.input.v1");
worth_query_operation!(pub AcceptReplacementCandidate(AcceptReplacementCandidateInput) in InterfaceCompilerSchema);
worth_query_operation_reads!(AcceptReplacementCandidate => [
    CapabilityIdentifier,
    CapabilityRevision,
    CapabilityStatus,
    CapabilityActiveReplayIdentifier,
    CapabilityCandidateReplayIdentifier,
    CapabilityBrokenReplayIdentifier,
    CapabilityFailureJson,
    ReplayIdentifier,
    ReplayRevision,
    ReplayCapabilityIdentifier,
    ReplayVersion,
    ReplayStatus,
    ReplayBrokenAt
]);
impl declaration::application_schema::OperationCreates<AcceptReplacementCandidate> for Replay {}
worth_query_operation_writes!(AcceptReplacementCandidate => [
    CapabilityRevision,
    CapabilityStatus,
    CapabilityActiveReplayIdentifier,
    CapabilityCandidateReplayIdentifier,
    CapabilityBrokenReplayIdentifier,
    CapabilityFailureJson,
    ReplayIdentifier,
    ReplayRevision,
    ReplayCapabilityIdentifier,
    ReplayVersion,
    ReplayStepsJson,
    ReplayConfidenceMillis,
    ReplayStatus,
    ReplayCreatedAt,
    ReplayDiscoveredFromExperimentIdentifier,
    ReplaySupersedesIdentifier,
    ReplayVerifiedAt,
    ReplayVerificationJson,
    ReplayFailureJson,
    ReplayBrokenAt
]);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordReplacementVerificationInput {
    pub capability_id: String,
    pub replay_version_id: String,
    pub expected_capability_revision: u64,
    pub expected_replay_revision: u64,
    pub verification_run_json: String,
}
worth_query_portable_type!(RecordReplacementVerificationInput => "interface-compiler.worth.record-replacement-verification.input.v1");
worth_query_operation!(pub RecordReplacementVerification(RecordReplacementVerificationInput) in InterfaceCompilerSchema);
worth_query_operation_reads!(RecordReplacementVerification => [
    CapabilityIdentifier,
    CapabilityRevision,
    CapabilityStatus,
    CapabilityActiveReplayIdentifier,
    CapabilityCandidateReplayIdentifier,
    CapabilityBrokenReplayIdentifier,
    CapabilityFailureJson,
    ReplayIdentifier,
    ReplayRevision,
    ReplayCapabilityIdentifier,
    ReplayStatus,
    ReplayCreatedAt,
    ReplayVerificationJson,
    ReplayFailureJson,
    ReplayBrokenAt
]);
worth_query_operation_writes!(RecordReplacementVerification => [
    CapabilityRevision,
    CapabilityStatus,
    CapabilityCandidateReplayIdentifier,
    CapabilityBrokenReplayIdentifier,
    CapabilityFailureJson,
    ReplayRevision,
    ReplayStatus,
    ReplayVerificationJson,
    ReplayFailureJson,
    ReplayBrokenAt
]);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActivateReplacementInput {
    pub capability_id: String,
    pub replay_version_id: String,
    pub expected_capability_revision: u64,
    pub expected_replay_revision: u64,
    pub verified_at: String,
}
worth_query_portable_type!(ActivateReplacementInput => "interface-compiler.worth.activate-replacement.input.v1");
worth_query_operation!(pub ActivateReplacement(ActivateReplacementInput) in InterfaceCompilerSchema);
worth_query_operation_reads!(ActivateReplacement => [
    CapabilityIdentifier,
    CapabilityRevision,
    CapabilityStatus,
    CapabilityActiveReplayIdentifier,
    CapabilityCandidateReplayIdentifier,
    CapabilityBrokenReplayIdentifier,
    CapabilityFailureJson,
    ReplayIdentifier,
    ReplayRevision,
    ReplayCapabilityIdentifier,
    ReplayStatus,
    ReplayCreatedAt,
    ReplaySupersedesIdentifier,
    ReplayVerificationJson,
    ReplayVerifiedAt
]);
worth_query_operation_writes!(ActivateReplacement => [
    CapabilityRevision,
    CapabilityStatus,
    CapabilityActiveReplayIdentifier,
    CapabilityCandidateReplayIdentifier,
    CapabilityBrokenReplayIdentifier,
    CapabilityFailureJson,
    ReplayRevision,
    ReplayStatus,
    ReplayVerifiedAt
]);
