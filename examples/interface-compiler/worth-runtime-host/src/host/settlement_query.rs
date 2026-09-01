use super::*;
use crate::application::*;
use worth_query_host::facade::{admission, declaration, primary_graph};
impl InterfaceCompilerWorthHost {
    pub(super) fn query_event_journal(
        &self,
        principal: &primary_graph::WorthQueryAuthenticatedPrincipal<
            InterfaceCompilerSchema,
            Principal,
            u64,
        >,
        entity: &primary_graph::WorthQueryApplicationEntityIdentity<
            InterfaceCompilerSchema,
            EventJournal,
        >,
        scope: &admission::authenticated_principal::WorthQueryRequestScope,
    ) -> Result<
        (
            InterfaceCompilerEventJournalProjection,
            InterfaceCompilerExecutionQueryEvidence,
        ),
        String,
    > {
        let query = self
            .application
            .installed_schema()
            .application_query(EventJournalReadQuery::reference())
            .map_err(|error| format!("journal query unavailable: {error:?}"))?;
        let access = primary_graph::WorthQueryApplicationQueryAccessContext::new(principal, entity);
        let plan = self
            .application
            .admit_application_query(
                &query,
                &access,
                declaration::application_query::ApplicationQueryParameterSet::new().bind(
                    event_journal_id_parameter(),
                    DEMO_EVENT_JOURNAL_ID.to_string(),
                ),
                primary_graph::WorthQueryApplicationQueryControls::current_one_shot(
                    std::num::NonZeroUsize::new(1).unwrap(),
                    std::num::NonZeroUsize::new(256 * 1024).unwrap(),
                    scope,
                ),
            )
            .map_err(|error| format!("journal query denied: {error:?}"))?;
        let result = self
            .application
            .execute_application_query_one_shot(plan)
            .map_err(|error| format!("journal query execution denied: {error:?}"))?;
        let projection = result
            .rows()
            .first()
            .cloned()
            .ok_or("journal projection missing")?;
        let receipt = result.receipt();
        Ok((
            projection,
            InterfaceCompilerExecutionQueryEvidence {
                query_name: EVENT_JOURNAL_READ_QUERY_NAME.to_string(),
                query_identity: receipt.query_identity().render_support_hex(),
                basis_version: receipt.basis_version().as_u64(),
                projected_record_count: receipt.projected_record_count(),
                projected_field_count: receipt.projected_field_count(),
                basis_released: receipt.basis_released(),
            },
        ))
    }
}
