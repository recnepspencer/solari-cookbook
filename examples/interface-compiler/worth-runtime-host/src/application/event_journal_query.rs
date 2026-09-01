use super::*;
use worth_query_host::facade::{declaration, primary_graph};

pub fn event_journal_read_query_definition(
) -> declaration::application_query::ApplicationQueryDefinition<
    InterfaceCompilerSchema,
    EventJournalReadQuery,
    EventJournalReadParameters,
    InterfaceCompilerEventJournalProjection,
    EventJournal,
> {
    let shape = declaration::application_query::ApplicationQueryResultShapeBuilder::new(
        EventJournal::reference(),
    )
    .field(id_result())
    .field(revision_result())
    .field(events_result())
    .build();
    declaration::application_query::ApplicationQueryDefinitionBuilder::declare(
        EventJournalReadQuery::reference(),
    )
    .root(EventJournal::reference())
    .scope(EventJournal::reference())
    .result_shape(shape)
    .cardinality(declaration::application_query::ApplicationQueryCardinality::ExactlyOne)
    .dependency_ceiling(
        declaration::application_query::ApplicationQueryDependencyCeiling::bounded(0, 0, 3),
    )
    .disclosure(declaration::application_query::ApplicationQueryDisclosureContract::public())
    .basis_support(
        declaration::application_query::ApplicationQueryBasisSupport::current_and_pinned(),
    )
    .lanes(declaration::application_query::ApplicationQueryLaneEligibility::one_shot())
    .public()
    .parameter(event_journal_id_parameter())
    .where_equal(
        EventJournalIdentifier::reference(),
        event_journal_id_parameter(),
    )
    .build()
    .expect("event journal query is valid")
}
pub fn event_journal_id_parameter() -> declaration::application_query::ApplicationQueryParameterRef<
    EventJournalReadQuery,
    EventJournalIdParameter,
    String,
> {
    declaration::application_query::ApplicationQueryParameterRef::from_query_identifier(
        "journal_id",
    )
}
type Field<S, F, V, W> = declaration::application_query::ApplicationQueryResultFieldRef<
    EventJournalReadQuery,
    S,
    InterfaceCompilerSchema,
    EventJournal,
    EventJournalFacts,
    F,
    V,
    W,
    declaration::application_schema::EqualityPredicate,
    declaration::application_schema::NoApplicationUnit,
>;
fn id_result() -> Field<
    EventJournalIdSlot,
    EventJournalIdentifier,
    String,
    declaration::application_schema::ReadOnly,
> {
    declaration::application_query::ApplicationQueryResultFieldRef::new(
        "journal_id",
        EventJournalIdentifier::reference(),
    )
}
fn revision_result() -> Field<
    EventJournalRevisionSlot,
    EventJournalRevision,
    u64,
    declaration::application_schema::ReadWrite,
> {
    declaration::application_query::ApplicationQueryResultFieldRef::new(
        "revision",
        EventJournalRevision::reference(),
    )
}
fn events_result() -> Field<
    EventJournalEventsSlot,
    EventJournalEventsJson,
    String,
    declaration::application_schema::ReadWrite,
> {
    declaration::application_query::ApplicationQueryResultFieldRef::new(
        "events_json",
        EventJournalEventsJson::reference(),
    )
}
impl primary_graph::WorthQueryApplicationProjection<InterfaceCompilerSchema, EventJournalReadQuery>
    for InterfaceCompilerEventJournalProjection
{
    fn project(
        row: &primary_graph::WorthQueryApplicationProjectionRow<
            '_,
            InterfaceCompilerSchema,
            EventJournalReadQuery,
        >,
    ) -> Result<Self, primary_graph::WorthQueryApplicationProjectionDenial> {
        Ok(Self {
            journal_id: row.field(id_result())?,
            revision: row.field(revision_result())?,
            events_json: row.field(events_result())?,
        })
    }
}
