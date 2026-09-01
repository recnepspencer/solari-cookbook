//! Capability and active-replay query projection schema.

use worth_query_host::facade::{declaration, primary_graph};
use worth_query_host::facade::{worth_query_application_query, worth_query_portable_type};

use super::replay_recovery_schema::{
    CapabilityBrokenReplayIdentifier, CapabilityCandidateReplayIdentifier, CapabilityFailureJson,
    ReplayBrokenAt, ReplayDiscoveredFromExperimentIdentifier, ReplayFailureJson,
    ReplaySupersedesIdentifier,
};
use super::schema::*;

pub struct CapabilityReadParameters;
pub struct CapabilityIdParameter;
pub struct CapabilityIdSlot;
pub struct CapabilityRevisionSlot;
pub struct CapabilityApplicationIdSlot;
pub struct CapabilityNameSlot;
pub struct CapabilityDescriptionSlot;
pub struct CapabilityStatusSlot;
pub struct CapabilityActiveReplayIdSlot;
pub struct CapabilityCandidateReplayIdSlot;
pub struct CapabilityBrokenReplayIdSlot;
pub struct CapabilityFailureJsonSlot;
pub struct ActiveReplayReadParameters;
pub struct ReplayIdParameter;
pub struct ReplayIdSlot;
pub struct ReplayRevisionSlot;
pub struct ReplayCapabilityIdSlot;
pub struct ReplayVersionSlot;
pub struct ReplayStepsJsonSlot;
pub struct ReplayConfidenceMillisSlot;
pub struct ReplayStatusSlot;
pub struct ReplayCreatedAtSlot;
pub struct ReplayDiscoveredFromExperimentIdSlot;
pub struct ReplaySupersedesIdSlot;
pub struct ReplayVerifiedAtSlot;
pub struct ReplayVerificationJsonSlot;
pub struct ReplayFailureJsonSlot;
pub struct ReplayBrokenAtSlot;

macro_rules! portable_slot { ($slot:ty, $name:literal) => { worth_query_portable_type!($slot => $name); }; }
portable_slot!(
    CapabilityIdSlot,
    "interface-compiler.worth.capability-read.id.v1"
);
portable_slot!(
    CapabilityRevisionSlot,
    "interface-compiler.worth.capability-read.revision.v1"
);
portable_slot!(
    CapabilityApplicationIdSlot,
    "interface-compiler.worth.capability-read.application-id.v1"
);
portable_slot!(
    CapabilityNameSlot,
    "interface-compiler.worth.capability-read.name.v1"
);
portable_slot!(
    CapabilityDescriptionSlot,
    "interface-compiler.worth.capability-read.description.v1"
);
portable_slot!(
    CapabilityStatusSlot,
    "interface-compiler.worth.capability-read.status.v1"
);
portable_slot!(
    CapabilityActiveReplayIdSlot,
    "interface-compiler.worth.capability-read.active-replay-id.v1"
);
portable_slot!(
    CapabilityCandidateReplayIdSlot,
    "interface-compiler.worth.capability-read.candidate-replay-id.v1"
);
portable_slot!(
    CapabilityBrokenReplayIdSlot,
    "interface-compiler.worth.capability-read.broken-replay-id.v1"
);
portable_slot!(
    CapabilityFailureJsonSlot,
    "interface-compiler.worth.capability-read.failure-json.v1"
);
portable_slot!(
    ReplayIdSlot,
    "interface-compiler.worth.active-replay-read.id.v1"
);
portable_slot!(
    ReplayRevisionSlot,
    "interface-compiler.worth.active-replay-read.revision.v1"
);
portable_slot!(
    ReplayCapabilityIdSlot,
    "interface-compiler.worth.active-replay-read.capability-id.v1"
);
portable_slot!(
    ReplayVersionSlot,
    "interface-compiler.worth.active-replay-read.version.v1"
);
portable_slot!(
    ReplayStepsJsonSlot,
    "interface-compiler.worth.active-replay-read.steps-json.v1"
);
portable_slot!(
    ReplayConfidenceMillisSlot,
    "interface-compiler.worth.active-replay-read.confidence-millis.v1"
);
portable_slot!(
    ReplayStatusSlot,
    "interface-compiler.worth.active-replay-read.status.v1"
);
portable_slot!(
    ReplayCreatedAtSlot,
    "interface-compiler.worth.active-replay-read.created-at.v1"
);
portable_slot!(
    ReplayDiscoveredFromExperimentIdSlot,
    "interface-compiler.worth.replay-read.discovered-from-experiment-id.v1"
);
portable_slot!(
    ReplaySupersedesIdSlot,
    "interface-compiler.worth.replay-read.supersedes-id.v1"
);
portable_slot!(
    ReplayVerifiedAtSlot,
    "interface-compiler.worth.active-replay-read.verified-at.v1"
);
portable_slot!(
    ReplayVerificationJsonSlot,
    "interface-compiler.worth.active-replay-read.verification-json.v1"
);
portable_slot!(
    ReplayFailureJsonSlot,
    "interface-compiler.worth.replay-read.failure-json.v1"
);
portable_slot!(
    ReplayBrokenAtSlot,
    "interface-compiler.worth.replay-read.broken-at.v1"
);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerCapabilityProjection {
    pub id: String,
    pub revision: u64,
    pub application_id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub active_replay_id: Option<String>,
    pub candidate_replay_id: Option<String>,
    pub broken_replay_id: Option<String>,
    pub failure_json: Option<String>,
}
worth_query_portable_type!(InterfaceCompilerCapabilityProjection => "interface-compiler.worth.capability-read.result.v1");
worth_query_application_query!(pub CapabilityReadQuery in InterfaceCompilerSchema, parameters CapabilityReadParameters, result InterfaceCompilerCapabilityProjection, scope Capability, name "interface_compiler_capability_read");

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerActiveReplayProjection {
    pub id: String,
    pub revision: u64,
    pub capability_id: String,
    pub version: u64,
    pub steps_json: String,
    pub confidence_millis: u64,
    pub status: String,
    pub created_at: String,
    pub discovered_from_experiment_id: String,
    pub supersedes_id: Option<String>,
    pub verified_at: Option<String>,
    pub verification_json: String,
    pub failure_json: Option<String>,
    pub broken_at: Option<String>,
}
worth_query_portable_type!(InterfaceCompilerActiveReplayProjection => "interface-compiler.worth.active-replay-read.result.v1");
worth_query_application_query!(pub ActiveReplayReadQuery in InterfaceCompilerSchema, parameters ActiveReplayReadParameters, result InterfaceCompilerActiveReplayProjection, scope Replay, name "interface_compiler_active_replay_read");

type CapabilityResultField<Slot, Field, Value> =
    declaration::application_query::ApplicationQueryResultFieldRef<
        CapabilityReadQuery,
        Slot,
        InterfaceCompilerSchema,
        Capability,
        CapabilityFacts,
        Field,
        Value,
        declaration::application_schema::ReadOnly,
        declaration::application_schema::EqualityPredicate,
        declaration::application_schema::NoApplicationUnit,
    >;
type CapabilityMutableResultField<Slot, Field, Value> =
    declaration::application_query::ApplicationQueryResultFieldRef<
        CapabilityReadQuery,
        Slot,
        InterfaceCompilerSchema,
        Capability,
        CapabilityFacts,
        Field,
        Value,
        declaration::application_schema::ReadWrite,
        declaration::application_schema::EqualityPredicate,
        declaration::application_schema::NoApplicationUnit,
    >;
type ReplayResultField<Slot, Field, Value> =
    declaration::application_query::ApplicationQueryResultFieldRef<
        ActiveReplayReadQuery,
        Slot,
        InterfaceCompilerSchema,
        Replay,
        ReplayFacts,
        Field,
        Value,
        declaration::application_schema::ReadOnly,
        declaration::application_schema::EqualityPredicate,
        declaration::application_schema::NoApplicationUnit,
    >;
type ReplayMutableResultField<Slot, Field, Value> =
    declaration::application_query::ApplicationQueryResultFieldRef<
        ActiveReplayReadQuery,
        Slot,
        InterfaceCompilerSchema,
        Replay,
        ReplayFacts,
        Field,
        Value,
        declaration::application_schema::ReadWrite,
        declaration::application_schema::EqualityPredicate,
        declaration::application_schema::NoApplicationUnit,
    >;
type CapabilityOptionalResultField<Slot, Field, Value> =
    declaration::application_query::ApplicationQueryOptionalResultFieldRef<
        CapabilityReadQuery,
        Slot,
        InterfaceCompilerSchema,
        Capability,
        CapabilityFacts,
        Field,
        Value,
        declaration::application_schema::ReadWrite,
        declaration::application_schema::EqualityPredicate,
        declaration::application_schema::NoApplicationUnit,
    >;
type ReplayOptionalResultField<Slot, Field, Value, Equality> =
    declaration::application_query::ApplicationQueryOptionalResultFieldRef<
        ActiveReplayReadQuery,
        Slot,
        InterfaceCompilerSchema,
        Replay,
        ReplayFacts,
        Field,
        Value,
        declaration::application_schema::ReadWrite,
        Equality,
        declaration::application_schema::NoApplicationUnit,
    >;

macro_rules! result_field {
    ($fn:ident, $alias:ident, $slot:ty, $field:ty, $value:ty, $name:literal) => {
        pub fn $fn() -> $alias<$slot, $field, $value> {
            declaration::application_query::ApplicationQueryResultFieldRef::new(
                $name,
                <$field>::reference(),
            )
        }
    };
}
result_field!(
    capability_id_result,
    CapabilityResultField,
    CapabilityIdSlot,
    CapabilityIdentifier,
    String,
    "capability_id"
);
result_field!(
    capability_revision_result,
    CapabilityMutableResultField,
    CapabilityRevisionSlot,
    CapabilityRevision,
    u64,
    "revision"
);
result_field!(
    capability_application_id_result,
    CapabilityResultField,
    CapabilityApplicationIdSlot,
    CapabilityApplicationIdentifier,
    String,
    "application_id"
);
result_field!(
    capability_name_result,
    CapabilityResultField,
    CapabilityNameSlot,
    CapabilityName,
    String,
    "name"
);
result_field!(
    capability_description_result,
    CapabilityResultField,
    CapabilityDescriptionSlot,
    CapabilityDescription,
    String,
    "description"
);
result_field!(
    capability_status_result,
    CapabilityMutableResultField,
    CapabilityStatusSlot,
    CapabilityStatus,
    String,
    "status"
);
pub fn capability_active_replay_id_result() -> CapabilityMutableResultField<
    CapabilityActiveReplayIdSlot,
    CapabilityActiveReplayIdentifier,
    String,
> {
    declaration::application_query::ApplicationQueryResultFieldRef::new(
        "active_replay_id",
        CapabilityActiveReplayIdentifier::reference(),
    )
}
pub fn capability_candidate_replay_id_result() -> CapabilityOptionalResultField<
    CapabilityCandidateReplayIdSlot,
    CapabilityCandidateReplayIdentifier,
    String,
> {
    declaration::application_query::ApplicationQueryOptionalResultFieldRef::new(
        "candidate_replay_id",
        CapabilityCandidateReplayIdentifier::reference(),
    )
}
pub fn capability_broken_replay_id_result() -> CapabilityOptionalResultField<
    CapabilityBrokenReplayIdSlot,
    CapabilityBrokenReplayIdentifier,
    String,
> {
    declaration::application_query::ApplicationQueryOptionalResultFieldRef::new(
        "broken_replay_id",
        CapabilityBrokenReplayIdentifier::reference(),
    )
}
pub fn capability_failure_json_result(
) -> declaration::application_query::ApplicationQueryOptionalResultFieldRef<
    CapabilityReadQuery,
    CapabilityFailureJsonSlot,
    InterfaceCompilerSchema,
    Capability,
    CapabilityFacts,
    CapabilityFailureJson,
    String,
    declaration::application_schema::ReadWrite,
    declaration::application_schema::NoEqualityPredicate,
    declaration::application_schema::NoApplicationUnit,
> {
    declaration::application_query::ApplicationQueryOptionalResultFieldRef::new(
        "failure_json",
        CapabilityFailureJson::reference(),
    )
}
result_field!(
    replay_id_result,
    ReplayResultField,
    ReplayIdSlot,
    ReplayIdentifier,
    String,
    "replay_id"
);
result_field!(
    replay_revision_result,
    ReplayMutableResultField,
    ReplayRevisionSlot,
    ReplayRevision,
    u64,
    "revision"
);
result_field!(
    replay_capability_id_result,
    ReplayResultField,
    ReplayCapabilityIdSlot,
    ReplayCapabilityIdentifier,
    String,
    "capability_id"
);
result_field!(
    replay_version_result,
    ReplayResultField,
    ReplayVersionSlot,
    ReplayVersion,
    u64,
    "version"
);
result_field!(
    replay_steps_json_result,
    ReplayResultField,
    ReplayStepsJsonSlot,
    ReplayStepsJson,
    String,
    "steps_json"
);
result_field!(
    replay_confidence_millis_result,
    ReplayResultField,
    ReplayConfidenceMillisSlot,
    ReplayConfidenceMillis,
    u64,
    "confidence_millis"
);
result_field!(
    replay_status_result,
    ReplayMutableResultField,
    ReplayStatusSlot,
    ReplayStatus,
    String,
    "status"
);
result_field!(
    replay_created_at_result,
    ReplayResultField,
    ReplayCreatedAtSlot,
    ReplayCreatedAt,
    String,
    "created_at"
);
result_field!(
    replay_discovered_from_experiment_id_result,
    ReplayResultField,
    ReplayDiscoveredFromExperimentIdSlot,
    ReplayDiscoveredFromExperimentIdentifier,
    String,
    "discovered_from_experiment_id"
);
pub fn replay_supersedes_id_result() -> ReplayOptionalResultField<
    ReplaySupersedesIdSlot,
    ReplaySupersedesIdentifier,
    String,
    declaration::application_schema::EqualityPredicate,
> {
    declaration::application_query::ApplicationQueryOptionalResultFieldRef::new(
        "supersedes_id",
        ReplaySupersedesIdentifier::reference(),
    )
}
pub fn replay_verified_at_result() -> ReplayOptionalResultField<
    ReplayVerifiedAtSlot,
    ReplayVerifiedAt,
    String,
    declaration::application_schema::EqualityPredicate,
> {
    declaration::application_query::ApplicationQueryOptionalResultFieldRef::new(
        "verified_at",
        ReplayVerifiedAt::reference(),
    )
}
result_field!(
    replay_verification_json_result,
    ReplayMutableResultField,
    ReplayVerificationJsonSlot,
    ReplayVerificationJson,
    String,
    "verification_json"
);
pub fn replay_failure_json_result() -> ReplayOptionalResultField<
    ReplayFailureJsonSlot,
    ReplayFailureJson,
    String,
    declaration::application_schema::NoEqualityPredicate,
> {
    declaration::application_query::ApplicationQueryOptionalResultFieldRef::new(
        "failure_json",
        ReplayFailureJson::reference(),
    )
}
pub fn replay_broken_at_result() -> ReplayOptionalResultField<
    ReplayBrokenAtSlot,
    ReplayBrokenAt,
    String,
    declaration::application_schema::EqualityPredicate,
> {
    declaration::application_query::ApplicationQueryOptionalResultFieldRef::new(
        "broken_at",
        ReplayBrokenAt::reference(),
    )
}

pub fn capability_id_parameter() -> declaration::application_query::ApplicationQueryParameterRef<
    CapabilityReadQuery,
    CapabilityIdParameter,
    String,
> {
    declaration::application_query::ApplicationQueryParameterRef::from_query_identifier(
        "capability_id",
    )
}
pub fn replay_id_parameter() -> declaration::application_query::ApplicationQueryParameterRef<
    ActiveReplayReadQuery,
    ReplayIdParameter,
    String,
> {
    declaration::application_query::ApplicationQueryParameterRef::from_query_identifier("replay_id")
}

impl primary_graph::WorthQueryApplicationProjection<InterfaceCompilerSchema, CapabilityReadQuery>
    for InterfaceCompilerCapabilityProjection
{
    fn project(
        row: &primary_graph::WorthQueryApplicationProjectionRow<
            '_,
            InterfaceCompilerSchema,
            CapabilityReadQuery,
        >,
    ) -> Result<Self, primary_graph::WorthQueryApplicationProjectionDenial> {
        Ok(Self {
            id: row.field(capability_id_result())?,
            revision: row.field(capability_revision_result())?,
            application_id: row.field(capability_application_id_result())?,
            name: row.field(capability_name_result())?,
            description: row.field(capability_description_result())?,
            status: row.field(capability_status_result())?,
            active_replay_id: Some(row.field(capability_active_replay_id_result())?),
            candidate_replay_id: row.optional_field(capability_candidate_replay_id_result())?,
            broken_replay_id: row.optional_field(capability_broken_replay_id_result())?,
            failure_json: row.optional_field(capability_failure_json_result())?,
        })
    }
}
impl primary_graph::WorthQueryApplicationProjection<InterfaceCompilerSchema, ActiveReplayReadQuery>
    for InterfaceCompilerActiveReplayProjection
{
    fn project(
        row: &primary_graph::WorthQueryApplicationProjectionRow<
            '_,
            InterfaceCompilerSchema,
            ActiveReplayReadQuery,
        >,
    ) -> Result<Self, primary_graph::WorthQueryApplicationProjectionDenial> {
        Ok(Self {
            id: row.field(replay_id_result())?,
            revision: row.field(replay_revision_result())?,
            capability_id: row.field(replay_capability_id_result())?,
            version: row.field(replay_version_result())?,
            steps_json: row.field(replay_steps_json_result())?,
            confidence_millis: row.field(replay_confidence_millis_result())?,
            status: row.field(replay_status_result())?,
            created_at: row.field(replay_created_at_result())?,
            discovered_from_experiment_id: row
                .field(replay_discovered_from_experiment_id_result())?,
            supersedes_id: row.optional_field(replay_supersedes_id_result())?,
            verified_at: row.optional_field(replay_verified_at_result())?,
            verification_json: row.field(replay_verification_json_result())?,
            failure_json: row.optional_field(replay_failure_json_result())?,
            broken_at: row.optional_field(replay_broken_at_result())?,
        })
    }
}
