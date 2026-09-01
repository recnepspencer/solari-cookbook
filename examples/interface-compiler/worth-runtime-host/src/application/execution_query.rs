//! Typed execution projection query declaration.

use worth_query_host::facade::declaration;

use super::{
    execution_capability_result, execution_id_parameter, execution_id_result,
    execution_lifecycle_result, execution_mode_result, execution_replay_result,
    execution_revision_result, execution_settlement_result, execution_start_metrics_result,
    Execution, ExecutionIdentifier, ExecutionReadParameters, ExecutionReadQuery,
    InterfaceCompilerExecutionProjection, InterfaceCompilerSchema,
};

pub fn execution_read_query_definition(
) -> declaration::application_query::ApplicationQueryDefinition<
    InterfaceCompilerSchema,
    ExecutionReadQuery,
    ExecutionReadParameters,
    InterfaceCompilerExecutionProjection,
    Execution,
> {
    let shape = declaration::application_query::ApplicationQueryResultShapeBuilder::new(
        Execution::reference(),
    )
    .field(execution_id_result())
    .field(execution_lifecycle_result())
    .field(execution_revision_result())
    .field(execution_settlement_result())
    .field(execution_capability_result())
    .field(execution_replay_result())
    .field(execution_mode_result())
    .field(execution_start_metrics_result())
    .build();

    declaration::application_query::ApplicationQueryDefinitionBuilder::declare(
        ExecutionReadQuery::reference(),
    )
    .root(Execution::reference())
    .scope(Execution::reference())
    .result_shape(shape)
    .cardinality(declaration::application_query::ApplicationQueryCardinality::ExactlyOne)
    .dependency_ceiling(
        declaration::application_query::ApplicationQueryDependencyCeiling::bounded(0, 0, 8),
    )
    .disclosure(declaration::application_query::ApplicationQueryDisclosureContract::public())
    .basis_support(
        declaration::application_query::ApplicationQueryBasisSupport::current_and_pinned(),
    )
    .lanes(declaration::application_query::ApplicationQueryLaneEligibility::one_shot())
    .public()
    .parameter(execution_id_parameter())
    .where_equal(ExecutionIdentifier::reference(), execution_id_parameter())
    .build()
    .expect("the Interface Compiler execution read query is valid")
}
