//! Typed application projection query declaration.

use super::schema::*;
use worth_query_host::facade::declaration;

pub fn application_read_query_definition(
) -> declaration::application_query::ApplicationQueryDefinition<
    InterfaceCompilerSchema,
    ApplicationReadQuery,
    ApplicationReadParameters,
    InterfaceCompilerApplicationProjection,
    Application,
> {
    let shape = declaration::application_query::ApplicationQueryResultShapeBuilder::new(
        Application::reference(),
    )
    .field(application_id_result())
    .field(application_revision_result())
    .field(application_name_result())
    .field(application_base_url_result())
    .build();

    declaration::application_query::ApplicationQueryDefinitionBuilder::declare(
        ApplicationReadQuery::reference(),
    )
    .root(Application::reference())
    .scope(Application::reference())
    .result_shape(shape)
    .cardinality(declaration::application_query::ApplicationQueryCardinality::ExactlyOne)
    .dependency_ceiling(
        declaration::application_query::ApplicationQueryDependencyCeiling::bounded(0, 0, 4),
    )
    .disclosure(declaration::application_query::ApplicationQueryDisclosureContract::public())
    .basis_support(
        declaration::application_query::ApplicationQueryBasisSupport::current_and_pinned(),
    )
    .lanes(declaration::application_query::ApplicationQueryLaneEligibility::one_shot())
    .public()
    .parameter(application_id_parameter())
    .where_equal(
        ApplicationIdentifier::reference(),
        application_id_parameter(),
    )
    .build()
    .expect("the Interface Compiler application read query is valid")
}
