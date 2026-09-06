//! Typed capability and active-replay projection query declarations.

use super::*;
use worth_query_host::facade::declaration;

pub fn capability_read_query_definition(
) -> declaration::application_query::ApplicationQueryDefinition<
    InterfaceCompilerSchema,
    CapabilityReadQuery,
    CapabilityReadParameters,
    InterfaceCompilerCapabilityProjection,
    Capability,
> {
    let shape = declaration::application_query::ApplicationQueryResultShapeBuilder::new(
        Capability::reference(),
    )
    .field(capability_id_result())
    .field(capability_revision_result())
    .field(capability_application_id_result())
    .field(capability_name_result())
    .field(capability_description_result())
    .field(capability_input_schema_json_result())
    .field(capability_output_schema_json_result())
    .field(capability_preconditions_json_result())
    .field(capability_postconditions_json_result())
    .field(capability_publication_json_result())
    .field(capability_status_result())
    .field(capability_active_replay_id_result())
    .optional_field(capability_candidate_replay_id_result())
    .optional_field(capability_broken_replay_id_result())
    .optional_field(capability_failure_json_result())
    .build();
    declaration::application_query::ApplicationQueryDefinitionBuilder::declare(
        CapabilityReadQuery::reference(),
    )
    .root(Capability::reference())
    .scope(Capability::reference())
    .result_shape(shape)
    .cardinality(declaration::application_query::ApplicationQueryCardinality::ExactlyOne)
    .dependency_ceiling(
        declaration::application_query::ApplicationQueryDependencyCeiling::bounded(0, 0, 15),
    )
    .disclosure(declaration::application_query::ApplicationQueryDisclosureContract::public())
    .basis_support(
        declaration::application_query::ApplicationQueryBasisSupport::current_and_pinned(),
    )
    .lanes(declaration::application_query::ApplicationQueryLaneEligibility::one_shot())
    .public()
    .parameter(capability_id_parameter())
    .where_equal(CapabilityIdentifier::reference(), capability_id_parameter())
    .build()
    .expect("the capability read query is valid")
}

pub fn active_replay_read_query_definition(
) -> declaration::application_query::ApplicationQueryDefinition<
    InterfaceCompilerSchema,
    ActiveReplayReadQuery,
    ActiveReplayReadParameters,
    InterfaceCompilerActiveReplayProjection,
    Replay,
> {
    let shape = declaration::application_query::ApplicationQueryResultShapeBuilder::new(
        Replay::reference(),
    )
    .field(replay_id_result())
    .field(replay_revision_result())
    .field(replay_capability_id_result())
    .field(replay_version_result())
    .field(replay_steps_json_result())
    .field(replay_confidence_millis_result())
    .field(replay_status_result())
    .field(replay_created_at_result())
    .field(replay_discovered_from_experiment_id_result())
    .optional_field(replay_supersedes_id_result())
    .optional_field(replay_verified_at_result())
    .field(replay_verification_json_result())
    .optional_field(replay_failure_json_result())
    .optional_field(replay_broken_at_result())
    .build();
    declaration::application_query::ApplicationQueryDefinitionBuilder::declare(
        ActiveReplayReadQuery::reference(),
    )
    .root(Replay::reference())
    .scope(Replay::reference())
    .result_shape(shape)
    .cardinality(declaration::application_query::ApplicationQueryCardinality::ExactlyOne)
    .dependency_ceiling(
        declaration::application_query::ApplicationQueryDependencyCeiling::bounded(0, 0, 15),
    )
    .disclosure(declaration::application_query::ApplicationQueryDisclosureContract::public())
    .basis_support(
        declaration::application_query::ApplicationQueryBasisSupport::current_and_pinned(),
    )
    .lanes(declaration::application_query::ApplicationQueryLaneEligibility::one_shot())
    .public()
    .parameter(replay_id_parameter())
    .where_equal(ReplayIdentifier::reference(), replay_id_parameter())
    .build()
    .expect("the active replay read query is valid")
}
