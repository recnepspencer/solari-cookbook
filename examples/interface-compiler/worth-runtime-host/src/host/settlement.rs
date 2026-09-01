use super::settlement_support::{
    allowed_event, binding, denied, journal_contains_event, scope, settlement_lifecycle,
    valid_measured_event, valid_settlement,
};
use super::*;
use crate::application::*;
use std::time::Duration;
use worth_query_host::facade::primary_graph;
#[derive(Clone, Debug)]
pub struct CompleteExecutionRequest {
    pub execution_id: String,
    pub expected_revision: u64,
    pub settlement: serde_json::Value,
    pub credential: String,
    pub timeout: Duration,
}
#[derive(Clone, Debug)]
pub struct PublishDomainEventRequest {
    pub event: serde_json::Value,
    pub credential: String,
    pub timeout: Duration,
}
#[derive(Clone, Debug)]
pub enum SettlementOutcome<P> {
    Applied {
        commit: InterfaceCompilerExecutionCommitKind,
        projection: P,
        evidence: InterfaceCompilerExecutionQueryEvidence,
    },
    Stale {
        expected: u64,
        actual: u64,
    },
    InvalidLifecycle {
        current: String,
    },
    Denied {
        stage: InterfaceCompilerStartExecutionDenialStage,
        detail: String,
    },
}

type CompleteAdmission = primary_graph::WorthQueryAdmittedApplicationOperation<
    InterfaceCompilerSchema,
    CompleteExecution,
    CompleteExecutionInput,
    Execution,
>;
type PublishAdmission = primary_graph::WorthQueryAdmittedApplicationOperation<
    InterfaceCompilerSchema,
    PublishDomainEvent,
    PublishDomainEventInput,
    EventJournal,
>;

impl InterfaceCompilerWorthHost {
    pub fn complete_execution(
        &self,
        request: CompleteExecutionRequest,
    ) -> SettlementOutcome<InterfaceCompilerExecutionProjection> {
        if request.execution_id.trim().is_empty()
            || request.credential.trim().is_empty()
            || request.timeout.is_zero()
            || request.timeout > MAX_REQUEST_TIMEOUT
            || !valid_settlement(&request.settlement)
        {
            return denied("invalid completion request");
        }
        let scope = scope(request.timeout);
        let principal = match self.authenticate_execution_principal(&request.credential, &scope) {
            Ok(v) => v,
            Err(_) => return denied("authentication denied"),
        };
        let entity = match self.resolve_execution(&request.execution_id, &scope) {
            Ok(v) => v,
            Err(_) => return denied("execution resolution denied"),
        };
        let settlement_json = match serde_json::to_string(&request.settlement) {
            Ok(v) => v,
            Err(_) => return denied("settlement is not serializable"),
        };
        let _input = CompleteExecutionInput {
            execution_id: request.execution_id.clone(),
            expected_revision: request.expected_revision,
            settlement_json: settlement_json.clone(),
        };
        let operation = match self
            .application
            .installed_schema()
            .installed_operation(CompleteExecution::reference())
        {
            Ok(v) => v,
            Err(_) => return denied("completion operation unavailable"),
        };
        let admission: CompleteAdmission = match self.application.authorize_operation(
            &principal,
            &entity,
            &operation,
            Default::default(),
            &scope,
        ) {
            Ok(v) => v,
            Err(e) => return denied(format!("operation admission denied: {e:?}")),
        };
        let mut id = None;
        let mut lifecycle = None;
        let mut revision = None;
        let mut retained_settlement = None;
        let mut start_metrics = None;
        let (_, projection, _) =
            match self
                .invariant
                .project_admitted_operation(&admission, |reader, s| {
                    id = reader
                        .decision_field(s, ExecutionIdentifier::reference())
                        .ok()
                        .flatten();
                    lifecycle = reader
                        .decision_field(s, ExecutionLifecycle::reference())
                        .ok()
                        .flatten();
                    revision = reader
                        .decision_field(s, ExecutionRevision::reference())
                        .ok()
                        .flatten();
                    retained_settlement = reader
                        .decision_field(s, ExecutionSettlementJson::reference())
                        .ok()
                        .flatten();
                    start_metrics = reader
                        .decision_field(s, ExecutionStartMetricsJson::reference())
                        .ok()
                        .flatten();
                }) {
                Ok(v) => v.into_parts(),
                Err(e) => return denied(format!("dependency projection denied: {e:?}")),
            };
        let actual = revision.unwrap_or(u64::MAX);
        let current = lifecycle.unwrap_or_default();
        if actual == request.expected_revision.saturating_add(1)
            && current == settlement_lifecycle(&request.settlement)
            && retained_settlement.as_deref() == Some(settlement_json.as_str())
        {
            return match self.query_execution(&principal, &entity, &request.execution_id, &scope) {
                Ok((projection, evidence)) => SettlementOutcome::Applied {
                    commit: InterfaceCompilerExecutionCommitKind::AlreadyCommitted,
                    projection,
                    evidence,
                },
                Err(e) => denied(e),
            };
        }
        if actual != request.expected_revision {
            return SettlementOutcome::Stale {
                expected: request.expected_revision,
                actual,
            };
        };
        if current != "started" {
            return SettlementOutcome::InvalidLifecycle { current };
        };
        if id.as_deref() != Some(request.execution_id.as_str()) {
            return denied("resolved execution identity changed");
        }
        if !super::settlement_support::settlement_follows_start(
            start_metrics.as_deref(),
            &request.settlement,
        ) {
            return denied("settlement endedAt precedes or cannot be compared with startedAt");
        }
        let deps = match self
            .application
            .begin_projected_application_read_attempt(admission, projection)
            .and_then(|r| r.complete_projected_dependencies())
        {
            Ok(v) => v,
            Err(e) => return denied(format!("dependency completion denied: {e:?}")),
        };
        let mut effects = deps.begin_effect_program();
        let target = match effects.existing_entity(&entity) {
            Ok(v) => v,
            Err(e) => return denied(format!("effect entity denied: {e:?}")),
        };
        let terminal = settlement_lifecycle(&request.settlement);
        if !matches!(terminal, "success" | "failure" | "stopped") {
            return denied("settlement status is invalid");
        }
        let next_revision = match request.expected_revision.checked_add(1) {
            Some(value) => value,
            None => return denied("execution revision is exhausted"),
        };
        if let Err(e) = effects.write_field(
            &target,
            ExecutionLifecycle::reference(),
            terminal.to_string(),
        ) {
            return denied(format!("effect write denied: {e:?}"));
        }
        if effects
            .write_field(&target, ExecutionRevision::reference(), next_revision)
            .is_err()
            || effects
                .write_field(
                    &target,
                    ExecutionSettlementJson::reference(),
                    settlement_json,
                )
                .is_err()
        {
            return denied("completion fact write denied");
        }
        let program = match effects.finish() {
            Ok(v) => v,
            Err(e) => return denied(format!("effect program denied: {e:?}")),
        };
        let binding = binding(
            b"complete",
            &request.execution_id,
            &request.expected_revision.to_string(),
            serde_json::to_string(&request.settlement)
                .unwrap()
                .as_bytes(),
        );
        let commit = match self
            .application
            .compare_and_commit_application(program, binding)
        {
            primary_graph::WorthQueryApplicationCommitOutcome::Committed(_) => {
                InterfaceCompilerExecutionCommitKind::Committed
            }
            primary_graph::WorthQueryApplicationCommitOutcome::AlreadyCommitted(_) => {
                InterfaceCompilerExecutionCommitKind::AlreadyCommitted
            }
            o => return denied(format!("commit denied: {o:?}")),
        };
        match self.query_execution(&principal, &entity, &request.execution_id, &scope) {
            Ok((projection, evidence)) => SettlementOutcome::Applied {
                commit,
                projection,
                evidence,
            },
            Err(e) => denied(e),
        }
    }

    pub fn publish_domain_event(
        &self,
        request: PublishDomainEventRequest,
    ) -> SettlementOutcome<InterfaceCompilerEventJournalProjection> {
        let event_id = request
            .event
            .get("eventId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let key = request
            .event
            .get("idempotencyKey")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let event_type = request
            .event
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if event_id.is_empty()
            || key.is_empty()
            || !allowed_event(event_type)
            || !valid_measured_event(&request.event)
            || request.credential.trim().is_empty()
            || request.timeout.is_zero()
            || request.timeout > MAX_REQUEST_TIMEOUT
            || request.event.get("protocol").and_then(|v| v.as_str())
                != Some("interface-compiler.events")
            || request.event.get("schemaVersion").and_then(|v| v.as_u64()) != Some(1)
        {
            return denied("domain event contract is invalid");
        }
        let scope = scope(request.timeout);
        let principal = match self.authenticate_execution_principal(&request.credential, &scope) {
            Ok(v) => v,
            Err(_) => return denied("authentication denied"),
        };
        let execution_id = request
            .event
            .get("payload")
            .and_then(|value| value.get("executionId"))
            .and_then(|value| value.as_str());
        let requested_journal_id = execution_id
            .map(super::execution_admission::execution_journal_id)
            .unwrap_or_else(|| DEMO_EVENT_JOURNAL_ID.to_string());
        let resolved = self.application.resolve_entity(
            EventJournalIdentifier::reference(),
            requested_journal_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        );
        let (journal_id, entity) = match resolved {
            Ok(value) => (requested_journal_id, value),
            Err(error) => return denied(format!("event journal resolution denied: {error:?}")),
        };
        let event_json = serde_json::to_string(&request.event).unwrap();
        let _input = PublishDomainEventInput {
            event_id: event_id.to_string(),
            idempotency_key: key.to_string(),
            event_json: event_json.clone(),
        };
        let operation = match self
            .application
            .installed_schema()
            .installed_operation(PublishDomainEvent::reference())
        {
            Ok(v) => v,
            Err(_) => return denied("publication operation unavailable"),
        };
        let admission: PublishAdmission = match self.application.authorize_operation(
            &principal,
            &entity,
            &operation,
            Default::default(),
            &scope,
        ) {
            Ok(v) => v,
            Err(e) => return denied(format!("publication admission denied: {e:?}")),
        };
        let mut revision = None;
        let mut events = None;
        let mut journal = None;
        let (_, projection, _) =
            match self
                .invariant
                .project_admitted_operation(&admission, |r, s| {
                    journal = r
                        .decision_field(s, EventJournalIdentifier::reference())
                        .ok()
                        .flatten();
                    revision = r
                        .decision_field(s, EventJournalRevision::reference())
                        .ok()
                        .flatten();
                    events = r
                        .decision_field(s, EventJournalEventsJson::reference())
                        .ok()
                        .flatten();
                }) {
                Ok(v) => v.into_parts(),
                Err(e) => return denied(format!("publication projection denied: {e:?}")),
            };
        if journal.as_deref() != Some(journal_id.as_str()) {
            return denied("event journal identity changed");
        }
        let mut retained: Vec<serde_json::Value> =
            serde_json::from_str(&events.unwrap_or_default()).unwrap_or_default();
        if let Some(existing) = retained.iter().find(|v| {
            v.get("eventId").and_then(|x| x.as_str()) == Some(event_id)
                || v.get("idempotencyKey").and_then(|x| x.as_str()) == Some(key)
        }) {
            if existing != &request.event {
                return denied("event identity was already used for a different event");
            };
            return match self.query_event_journal(&principal, &entity, &journal_id, &scope) {
                Ok((projection, evidence)) => SettlementOutcome::Applied {
                    commit: InterfaceCompilerExecutionCommitKind::AlreadyCommitted,
                    projection,
                    evidence,
                },
                Err(e) => denied(e),
            };
        }
        retained.push(request.event.clone());
        let next = serde_json::to_string(&retained).unwrap();
        let current = revision.unwrap_or(0);
        let deps = match self
            .application
            .begin_projected_application_read_attempt(admission, projection)
            .and_then(|r| r.complete_projected_dependencies())
        {
            Ok(v) => v,
            Err(e) => return denied(format!("publication dependencies denied: {e:?}")),
        };
        let mut effects = deps.begin_effect_program();
        let target = match effects.existing_entity(&entity) {
            Ok(v) => v,
            Err(e) => return denied(format!("publication target denied: {e:?}")),
        };
        if effects
            .write_field(&target, EventJournalRevision::reference(), current + 1)
            .is_err()
            || effects
                .write_field(&target, EventJournalEventsJson::reference(), next)
                .is_err()
        {
            return denied("publication effect denied");
        };
        let program = match effects.finish() {
            Ok(v) => v,
            Err(e) => return denied(format!("publication program denied: {e:?}")),
        };
        let commit = match self.application.compare_and_commit_application(
            program,
            binding(b"event", key, event_id, event_json.as_bytes()),
        ) {
            primary_graph::WorthQueryApplicationCommitOutcome::Committed(_) => {
                InterfaceCompilerExecutionCommitKind::Committed
            }
            primary_graph::WorthQueryApplicationCommitOutcome::AlreadyCommitted(_) => {
                InterfaceCompilerExecutionCommitKind::AlreadyCommitted
            }
            o => return denied(format!("publication commit denied: {o:?}")),
        };
        match self.query_event_journal(&principal, &entity, &journal_id, &scope) {
            Ok((p, e)) if journal_contains_event(&p, event_id, &request.event) => {
                SettlementOutcome::Applied {
                    commit,
                    projection: p,
                    evidence: e,
                }
            }
            Ok(_) => denied("committed publication is absent from the authoritative journal"),
            Err(e) => denied(e),
        }
    }
}
