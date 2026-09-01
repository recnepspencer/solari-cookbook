//! The application-specific WORTH schema and read projection.
//!
//! This module is deliberately the only place where the demo names its
//! application entities and query.  The host and process boundary consume the
//! typed products below; neither one creates a parallel application store.

use worth_query_host::facade::{declaration, primary_graph};
use worth_query_host::facade::{
    worth_query_application_query, worth_query_application_schema, worth_query_aspect,
    worth_query_entity, worth_query_field, worth_query_portable_type,
    worth_query_principal_binding, worth_query_relation,
};

pub const APPLICATION_READ_QUERY_NAME: &str = "interface_compiler_application_read";

worth_query_application_schema! {
    pub schema InterfaceCompilerSchema {
        owner: interface_compiler_host,
        version: (1, 0),
        members: |schema| {
            schema
                .entity(ExternalMapping::reference())
                .entity(Principal::reference())
                .entity(Application::reference())
                .aspect(ExternalMapping::reference(), ExternalIdentity::reference())
                .aspect(Principal::reference(), PrincipalIdentity::reference())
                .aspect(Application::reference(), ApplicationFacts::reference())
                .field(ExternalMapping::reference(), ExternalIdentityField::reference())
                .field(ExternalMapping::reference(), MappingStatusField::reference())
                .field(Principal::reference(), PrincipalIdentityField::reference())
                .field(Application::reference(), ApplicationIdentifier::reference())
                .field(Application::reference(), ApplicationRevision::reference())
                .field(Application::reference(), ApplicationName::reference())
                .field(Application::reference(), ApplicationBaseUrl::reference())
                .relation(
                    MappingTarget::reference(),
                    ExternalMapping::reference(),
                    Principal::reference(),
                )
                .principal_binding(InterfaceCompilerPrincipalBinding::reference())
                .application_query(application_read_query_definition())
        }
    }
}

worth_query_entity!(pub ExternalMapping in InterfaceCompilerSchema);
worth_query_entity!(pub Principal in InterfaceCompilerSchema);
worth_query_entity!(pub Application in InterfaceCompilerSchema);

worth_query_aspect!(
    pub ExternalIdentity in InterfaceCompilerSchema, ExternalMapping;
    identity = AspectIdentity(0x9a1c0041), revision = AspectContractRevision(1),
);
worth_query_aspect!(
    pub PrincipalIdentity in InterfaceCompilerSchema, Principal;
    identity = AspectIdentity(0x9a1c0042), revision = AspectContractRevision(1),
);
worth_query_aspect!(
    pub ApplicationFacts in InterfaceCompilerSchema, Application;
    identity = AspectIdentity(0x9a1c0043), revision = AspectContractRevision(1),
);

worth_query_field!(
    pub ExternalIdentityField in InterfaceCompilerSchema, ExternalMapping, ExternalIdentity:
    declaration::authentication::WorthQueryExternalPrincipalIdentity, read_only, equality
);
worth_query_field!(
    pub MappingStatusField in InterfaceCompilerSchema, ExternalMapping, ExternalIdentity:
    declaration::authentication::WorthQueryPrincipalMappingStatus, read_write, equality
);
worth_query_field!(
    pub PrincipalIdentityField in InterfaceCompilerSchema, Principal, PrincipalIdentity:
    u64, read_only, equality
);
worth_query_field!(
    pub ApplicationIdentifier in InterfaceCompilerSchema, Application, ApplicationFacts:
    String, read_only, equality
);
worth_query_field!(
    pub ApplicationRevision in InterfaceCompilerSchema, Application, ApplicationFacts:
    u64, read_only, equality
);
worth_query_field!(
    pub ApplicationName in InterfaceCompilerSchema, Application, ApplicationFacts:
    String, read_only, equality
);
worth_query_field!(
    pub ApplicationBaseUrl in InterfaceCompilerSchema, Application, ApplicationFacts:
    String, read_only, equality
);

worth_query_relation!(
    pub MappingTarget in InterfaceCompilerSchema,
    ExternalMapping => Principal
);

worth_query_principal_binding!(
    pub InterfaceCompilerPrincipalBinding in InterfaceCompilerSchema,
    mapping ExternalMapping {
        identity: ExternalIdentityField,
        status: MappingStatusField,
        target: MappingTarget => Principal,
        principal_identity: PrincipalIdentityField
    }
);

pub struct ApplicationReadParameters;
pub struct ApplicationIdParameter;
pub struct ApplicationIdSlot;
pub struct ApplicationRevisionSlot;
pub struct ApplicationNameSlot;
pub struct ApplicationBaseUrlSlot;

worth_query_portable_type!(
    ApplicationIdSlot => "interface-compiler.worth.application-read.application-id.v1"
);
worth_query_portable_type!(
    ApplicationRevisionSlot => "interface-compiler.worth.application-read.revision.v1"
);
worth_query_portable_type!(
    ApplicationNameSlot => "interface-compiler.worth.application-read.name.v1"
);
worth_query_portable_type!(
    ApplicationBaseUrlSlot => "interface-compiler.worth.application-read.base-url.v1"
);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerApplicationProjection {
    pub id: String,
    pub revision: u64,
    pub name: String,
    pub base_url: String,
}

worth_query_portable_type!(
    InterfaceCompilerApplicationProjection
        => "interface-compiler.worth.application-read.result.v1"
);

worth_query_application_query!(
    pub ApplicationReadQuery in InterfaceCompilerSchema,
    parameters ApplicationReadParameters,
    result InterfaceCompilerApplicationProjection,
    scope Application,
    name "interface_compiler_application_read"
);

impl primary_graph::WorthQueryApplicationProjection<InterfaceCompilerSchema, ApplicationReadQuery>
    for InterfaceCompilerApplicationProjection
{
    fn project(
        row: &primary_graph::WorthQueryApplicationProjectionRow<
            '_,
            InterfaceCompilerSchema,
            ApplicationReadQuery,
        >,
    ) -> Result<Self, primary_graph::WorthQueryApplicationProjectionDenial> {
        Ok(Self {
            id: row.field(application_id_result())?,
            revision: row.field(application_revision_result())?,
            name: row.field(application_name_result())?,
            base_url: row.field(application_base_url_result())?,
        })
    }
}

type ResultField<Slot, Field, Value> =
    declaration::application_query::ApplicationQueryResultFieldRef<
        ApplicationReadQuery,
        Slot,
        InterfaceCompilerSchema,
        Application,
        ApplicationFacts,
        Field,
        Value,
        declaration::application_schema::ReadOnly,
        declaration::application_schema::EqualityPredicate,
        declaration::application_schema::NoApplicationUnit,
    >;

pub fn application_id_parameter() -> declaration::application_query::ApplicationQueryParameterRef<
    ApplicationReadQuery,
    ApplicationIdParameter,
    String,
> {
    declaration::application_query::ApplicationQueryParameterRef::from_query_identifier(
        "application_id",
    )
}

pub fn application_id_result() -> ResultField<ApplicationIdSlot, ApplicationIdentifier, String> {
    declaration::application_query::ApplicationQueryResultFieldRef::new(
        "application_id",
        ApplicationIdentifier::reference(),
    )
}

pub fn application_revision_result(
) -> ResultField<ApplicationRevisionSlot, ApplicationRevision, u64> {
    declaration::application_query::ApplicationQueryResultFieldRef::new(
        "revision",
        ApplicationRevision::reference(),
    )
}

pub fn application_name_result() -> ResultField<ApplicationNameSlot, ApplicationName, String> {
    declaration::application_query::ApplicationQueryResultFieldRef::new(
        "name",
        ApplicationName::reference(),
    )
}

pub fn application_base_url_result(
) -> ResultField<ApplicationBaseUrlSlot, ApplicationBaseUrl, String> {
    declaration::application_query::ApplicationQueryResultFieldRef::new(
        "base_url",
        ApplicationBaseUrl::reference(),
    )
}

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
