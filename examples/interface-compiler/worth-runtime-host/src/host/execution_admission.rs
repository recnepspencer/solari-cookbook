//! Admission of caller-issued execution identities into WORTH authority.

use super::*;
use crate::application::*;
use worth_query_host::facade::primary_graph;

type Admission = primary_graph::WorthQueryAdmittedApplicationOperation<
    InterfaceCompilerSchema,
    AdmitExecution,
    AdmitExecutionInput,
    Capability,
>;

impl InterfaceCompilerWorthHost {
    pub fn admit_execution(
        &self,
        request: InterfaceCompilerStartExecutionRequest,
    ) -> InterfaceCompilerStartExecutionOutcome {
        if let Err(detail) = validate_admission(&request) {
            return denied(InterfaceCompilerStartExecutionDenialStage::Request, detail);
        }
        let scope = super::settlement_support::scope(request.timeout);
        let principal = match self.authenticate_execution_principal(&request.credential, &scope) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        if self
            .resolve_execution(&request.execution_id, &scope)
            .is_ok()
        {
            return InterfaceCompilerStartExecutionOutcome::LifecycleNotPending {
                execution_id: request.execution_id,
                current_lifecycle: "duplicate".into(),
            };
        }
        let capability = match self.application.resolve_entity(
            CapabilityIdentifier::reference(),
            request.capability_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::EntityResolution,
                    format!("capability resolution denied: {:?}", error.kind()),
                )
            }
        };
        let operation = match self
            .application
            .installed_schema()
            .installed_operation(AdmitExecution::reference())
        {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::OperationAdmission,
                    format!("operation unavailable: {error:?}"),
                )
            }
        };
        let admission: Admission = match self.application.authorize_operation(
            &principal,
            &capability,
            &operation,
            Default::default(),
            &scope,
        ) {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::OperationAdmission,
                    format!("admission denied: {error:?}"),
                )
            }
        };
        let program = match self.build_admission_program(admission, &request) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        let intent = serde_json::to_vec(&request.metrics).expect("validated metrics serialize");
        let binding = super::settlement_support::binding(
            b"admit-execution",
            &request.execution_id,
            &request.capability_id,
            &intent,
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
            outcome => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::Commit,
                    format!("admission commit denied: {outcome:?}"),
                )
            }
        };
        let execution = match self.resolve_execution(&request.execution_id, &scope) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        match self.query_execution(&principal, &execution, &request.execution_id, &scope) {
            Ok((projection, evidence)) => InterfaceCompilerStartExecutionOutcome::Transitioned {
                commit,
                projection,
                evidence,
            },
            Err(detail) => denied(InterfaceCompilerStartExecutionDenialStage::Query, detail),
        }
    }

    fn build_admission_program(
        &self,
        admission: Admission,
        request: &InterfaceCompilerStartExecutionRequest,
    ) -> Result<
        primary_graph::WorthQueryApplicationEffectProgram<
            InterfaceCompilerSchema,
            AdmitExecution,
            AdmitExecutionInput,
            Capability,
        >,
        InterfaceCompilerStartExecutionOutcome,
    > {
        let mut capability_id = None;
        let mut status = None;
        let mut active_replay = None;
        let (_, projection, _) = self
            .invariant
            .project_admitted_operation(&admission, |reader, scope| {
                capability_id = reader
                    .decision_field(scope, CapabilityIdentifier::reference())
                    .ok()
                    .flatten();
                status = reader
                    .decision_field(scope, CapabilityStatus::reference())
                    .ok()
                    .flatten();
                active_replay = reader
                    .decision_field(scope, CapabilityActiveReplayIdentifier::reference())
                    .ok()
                    .flatten();
            })
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::DependencyProjection,
                    format!("{error:?}"),
                )
            })?
            .into_parts();
        if capability_id.as_deref() != Some(request.capability_id.as_str()) {
            return Err(denied(
                InterfaceCompilerStartExecutionDenialStage::OperationAdmission,
                "capability is unknown",
            ));
        }
        let capability_status = status.as_deref().unwrap_or_default();
        let eligible = match request.mode.as_str() {
            "compiled" => capability_status == "healthy",
            "direct" => matches!(capability_status, "healthy" | "degraded"),
            _ => false,
        };
        if !eligible {
            return Err(denied(
                InterfaceCompilerStartExecutionDenialStage::OperationAdmission,
                "capability lifecycle does not admit this execution mode",
            ));
        }
        if request.mode == "compiled"
            && request.replay_version_id.as_deref() != active_replay.as_deref()
        {
            return Err(denied(
                InterfaceCompilerStartExecutionDenialStage::OperationAdmission,
                "compiled execution does not name the active replay",
            ));
        }
        let dependencies = self
            .application
            .begin_projected_application_read_attempt(admission, projection)
            .and_then(|reads| reads.complete_projected_dependencies())
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::DependencyProjection,
                    format!("{error:?}"),
                )
            })?;
        let mut effects = dependencies.begin_effect_program();
        let execution_key = primary_graph::WorthQueryApplicationEntityKey::new(
            &request.execution_id,
        )
        .map_err(|error| {
            denied(
                InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                format!("invalid execution key: {error:?}"),
            )
        })?;
        let execution = effects
            .create_entity(Execution::reference(), execution_key)
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                    format!("execution creation denied: {error:?}"),
                )
            })?;
        let journal_id = execution_journal_id(&request.execution_id);
        let journal_key =
            primary_graph::WorthQueryApplicationEntityKey::new(&journal_id).map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                    format!("invalid journal key: {error:?}"),
                )
            })?;
        let journal = effects
            .create_entity(EventJournal::reference(), journal_key)
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                    format!("journal creation denied: {error:?}"),
                )
            })?;
        let metrics = serde_json::to_string(&request.metrics).expect("validated metrics serialize");
        effects
            .initialize_field(
                &execution,
                ExecutionIdentifier::reference(),
                request.execution_id.clone(),
            )
            .and_then(|_| {
                effects.initialize_field(
                    &execution,
                    ExecutionLifecycle::reference(),
                    "started".to_string(),
                )
            })
            .and_then(|_| effects.initialize_field(&execution, ExecutionRevision::reference(), 0))
            .and_then(|_| {
                effects.initialize_field(
                    &execution,
                    ExecutionSettlementJson::reference(),
                    "null".to_string(),
                )
            })
            .and_then(|_| {
                effects.initialize_field(
                    &execution,
                    ExecutionCapabilityIdentifier::reference(),
                    request.capability_id.clone(),
                )
            })
            .and_then(|_| {
                effects.initialize_field(
                    &execution,
                    ExecutionReplayIdentifier::reference(),
                    request.replay_version_id.clone().unwrap_or_default(),
                )
            })
            .and_then(|_| {
                effects.initialize_field(
                    &execution,
                    ExecutionMode::reference(),
                    request.mode.clone(),
                )
            })
            .and_then(|_| {
                effects.initialize_field(
                    &execution,
                    ExecutionStartMetricsJson::reference(),
                    metrics,
                )
            })
            .and_then(|_| {
                effects.initialize_field(&journal, EventJournalIdentifier::reference(), journal_id)
            })
            .and_then(|_| effects.initialize_field(&journal, EventJournalRevision::reference(), 0))
            .and_then(|_| {
                effects.initialize_field(
                    &journal,
                    EventJournalEventsJson::reference(),
                    "[]".to_string(),
                )
            })
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                    format!("admission initialization denied: {error:?}"),
                )
            })?;
        effects.finish().map_err(|error| {
            denied(
                InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                format!("{error:?}"),
            )
        })
    }
}

pub(super) fn execution_journal_id(execution_id: &str) -> String {
    format!("event-journal.{execution_id}")
}

fn denied(
    stage: InterfaceCompilerStartExecutionDenialStage,
    detail: impl Into<String>,
) -> InterfaceCompilerStartExecutionOutcome {
    InterfaceCompilerStartExecutionOutcome::Denied {
        stage,
        detail: detail.into(),
    }
}

fn validate_admission(request: &InterfaceCompilerStartExecutionRequest) -> Result<(), String> {
    let valid_id = |value: &str, prefix: &str| {
        value.starts_with(prefix)
            && value.len() <= 200
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    };
    if !valid_id(&request.execution_id, "execution.") {
        return Err("execution identity is malformed".into());
    }
    if !valid_id(&request.capability_id, "capability.") {
        return Err("capability identity is malformed".into());
    }
    if request.credential.trim().is_empty()
        || request.timeout.is_zero()
        || request.timeout > MAX_REQUEST_TIMEOUT
    {
        return Err("request context is invalid".into());
    }
    if !matches!(request.mode.as_str(), "direct" | "compiled") {
        return Err("execution mode is not admitted by this host".into());
    }
    if request.mode == "direct" && request.replay_version_id.is_some() {
        return Err("direct execution cannot name a replay".into());
    }
    if request.mode == "compiled"
        && request
            .replay_version_id
            .as_deref()
            .map(|value| valid_id(value, "replay."))
            .unwrap_or(false)
            == false
    {
        return Err("compiled execution requires a valid replay identity".into());
    }
    if chrono::DateTime::parse_from_rfc3339(&request.metrics.started_at).is_err() {
        return Err("start metrics are malformed".into());
    }
    Ok(())
}
