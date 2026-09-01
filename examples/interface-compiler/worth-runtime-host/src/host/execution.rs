//! One application-specific execution lifecycle transition owned by WORTH.

use std::time::Instant;

use worth_query_host::facade::{admission, declaration, primary_graph};

use super::execution_idempotency::start_execution_idempotency_binding;
use super::{block_on, InterfaceCompilerWorthHost, MAX_REQUEST_TIMEOUT};
use super::{
    InterfaceCompilerExecutionCommitKind, InterfaceCompilerExecutionQueryEvidence,
    InterfaceCompilerStartExecutionDenialStage, InterfaceCompilerStartExecutionOutcome,
    InterfaceCompilerStartExecutionRequest,
};
use crate::application::{
    execution_id_parameter, Execution, ExecutionIdentifier, ExecutionLifecycle, ExecutionReadQuery,
    InterfaceCompilerExecutionProjection, InterfaceCompilerSchema, Principal, StartExecution,
    StartExecutionInput,
};

const EXECUTION_QUERY_RESULT_LIMIT: usize = 1;
const EXECUTION_QUERY_RESULT_BYTES: usize = 4 * 1024;

type ExecutionPrincipal =
    primary_graph::WorthQueryAuthenticatedPrincipal<InterfaceCompilerSchema, Principal, u64>;
type ExecutionIdentity =
    primary_graph::WorthQueryApplicationEntityIdentity<InterfaceCompilerSchema, Execution>;
type StartAdmission = primary_graph::WorthQueryAdmittedApplicationOperation<
    InterfaceCompilerSchema,
    StartExecution,
    StartExecutionInput,
    Execution,
>;
type StartProgram = primary_graph::WorthQueryApplicationEffectProgram<
    InterfaceCompilerSchema,
    StartExecution,
    StartExecutionInput,
    Execution,
>;

impl InterfaceCompilerWorthHost {
    pub fn start_execution(
        &self,
        request: InterfaceCompilerStartExecutionRequest,
    ) -> InterfaceCompilerStartExecutionOutcome {
        if let Err(detail) = validate_start_request(&request) {
            return denied(InterfaceCompilerStartExecutionDenialStage::Request, detail);
        }
        let cancellation = admission::authenticated_principal::WorthQueryCancellationSource::new();
        let scope = admission::authenticated_principal::WorthQueryRequestScope::new(
            Instant::now() + request.timeout,
            cancellation.token(),
        );
        let principal = match self.authenticate_execution_principal(&request.credential, &scope) {
            Ok(principal) => principal,
            Err(outcome) => return outcome,
        };
        let execution = match self.resolve_execution(&request.execution_id, &scope) {
            Ok(execution) => execution,
            Err(outcome) => return outcome,
        };
        let admission = match self.admit_start_operation(&principal, &execution, &scope) {
            Ok(admission) => admission,
            Err(outcome) => return outcome,
        };
        let (program, canonical_execution_id) =
            match self.build_start_effect_program(admission, &execution, &request.execution_id) {
                Ok(program) => program,
                Err(outcome) => return outcome,
            };
        let commit = match self.commit_start_program(program, &canonical_execution_id) {
            Ok(commit) => commit,
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

    fn authenticate_execution_principal(
        &self,
        credential: &str,
        scope: &admission::authenticated_principal::WorthQueryRequestScope,
    ) -> Result<ExecutionPrincipal, InterfaceCompilerStartExecutionOutcome> {
        let external = block_on(
            self.authentication
                .authenticate(credential.to_string(), scope),
        )
        .map_err(|error| {
            denied(
                InterfaceCompilerStartExecutionDenialStage::Authentication,
                format!("{:?}", error.kind()),
            )
        })?;
        self.application
            .resolve_authenticated_principal(
                &self.principal_binding,
                external,
                scope,
                primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
            )
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::PrincipalResolution,
                    format!("{:?}", error.kind()),
                )
            })
    }

    fn resolve_execution(
        &self,
        execution_id: &str,
        scope: &admission::authenticated_principal::WorthQueryRequestScope,
    ) -> Result<ExecutionIdentity, InterfaceCompilerStartExecutionOutcome> {
        self.application
            .resolve_entity(
                ExecutionIdentifier::reference(),
                execution_id.to_string(),
                scope,
                primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
            )
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::EntityResolution,
                    format!("{:?}", error.kind()),
                )
            })
    }

    fn admit_start_operation(
        &self,
        principal: &ExecutionPrincipal,
        execution: &ExecutionIdentity,
        scope: &admission::authenticated_principal::WorthQueryRequestScope,
    ) -> Result<StartAdmission, InterfaceCompilerStartExecutionOutcome> {
        let operation = self
            .application
            .installed_schema()
            .installed_operation(StartExecution::reference())
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::OperationAdmission,
                    format!("operation is not installed: {error:?}"),
                )
            })?;
        self.application
            .authorize_operation(principal, execution, &operation, Default::default(), scope)
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::OperationAdmission,
                    format!("{error:?}"),
                )
            })
    }

    fn build_start_effect_program(
        &self,
        admission: StartAdmission,
        execution: &ExecutionIdentity,
        execution_id: &str,
    ) -> Result<(StartProgram, String), InterfaceCompilerStartExecutionOutcome> {
        let mut projected_execution_id = None;
        let mut projected_lifecycle = None;
        let (_, projection, _) = self
            .invariant
            .project_admitted_operation(&admission, |reader, scope| {
                projected_execution_id = reader
                    .decision_field(scope, ExecutionIdentifier::reference())
                    .expect("the installed operation admits its execution identity read");
                projected_lifecycle = reader
                    .decision_field(scope, ExecutionLifecycle::reference())
                    .expect("the installed operation admits its execution lifecycle read");
            })
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::DependencyProjection,
                    format!("{error:?}"),
                )
            })?
            .into_parts();
        let current_lifecycle = projected_lifecycle
            .expect("the resolved execution has an authoritative lifecycle fact");
        let canonical_execution_id = projected_execution_id
            .expect("the resolved execution has an authoritative identifier fact");
        if current_lifecycle != super::DEMO_EXECUTION_PENDING {
            return Err(
                InterfaceCompilerStartExecutionOutcome::LifecycleNotPending {
                    execution_id: execution_id.to_string(),
                    current_lifecycle,
                },
            );
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
        let execution_effect = effects.existing_entity(execution).map_err(|error| {
            denied(
                InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                format!("{error:?}"),
            )
        })?;
        effects
            .write_field(
                &execution_effect,
                ExecutionLifecycle::reference(),
                super::DEMO_EXECUTION_STARTED.to_string(),
            )
            .map_err(|error| {
                denied(
                    InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                    format!("{error:?}"),
                )
            })?;
        let program = effects.finish().map_err(|error| {
            denied(
                InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                format!("{error:?}"),
            )
        })?;
        Ok((program, canonical_execution_id))
    }

    fn commit_start_program(
        &self,
        program: StartProgram,
        execution_id: &str,
    ) -> Result<InterfaceCompilerExecutionCommitKind, InterfaceCompilerStartExecutionOutcome> {
        let binding = start_execution_idempotency_binding(execution_id);
        match self
            .application
            .compare_and_commit_application(program, binding)
        {
            primary_graph::WorthQueryApplicationCommitOutcome::Committed(_) => {
                Ok(InterfaceCompilerExecutionCommitKind::Committed)
            }
            primary_graph::WorthQueryApplicationCommitOutcome::AlreadyCommitted(_) => {
                Ok(InterfaceCompilerExecutionCommitKind::AlreadyCommitted)
            }
            outcome => Err(denied(
                InterfaceCompilerStartExecutionDenialStage::Commit,
                format!("{outcome:?}"),
            )),
        }
    }

    fn query_execution(
        &self,
        principal: &ExecutionPrincipal,
        execution: &ExecutionIdentity,
        execution_id: &str,
        scope: &admission::authenticated_principal::WorthQueryRequestScope,
    ) -> Result<
        (
            InterfaceCompilerExecutionProjection,
            InterfaceCompilerExecutionQueryEvidence,
        ),
        String,
    > {
        let query = self
            .application
            .installed_schema()
            .application_query(ExecutionReadQuery::reference())
            .map_err(|error| format!("execution query is not installed: {error:?}"))?;
        let access =
            primary_graph::WorthQueryApplicationQueryAccessContext::new(principal, execution);
        let plan = self
            .application
            .admit_application_query(
                &query,
                &access,
                declaration::application_query::ApplicationQueryParameterSet::new()
                    .bind(execution_id_parameter(), execution_id.to_string()),
                primary_graph::WorthQueryApplicationQueryControls::current_one_shot(
                    std::num::NonZeroUsize::new(EXECUTION_QUERY_RESULT_LIMIT).unwrap(),
                    std::num::NonZeroUsize::new(EXECUTION_QUERY_RESULT_BYTES).unwrap(),
                    scope,
                ),
            )
            .map_err(|error| format!("execution query admission denied: {error:?}"))?;
        let result = self
            .application
            .execute_application_query_one_shot(plan)
            .map_err(|error| format!("execution query denied: {error:?}"))?;
        let projection = result
            .rows()
            .first()
            .cloned()
            .ok_or_else(|| "execution query returned no projection".to_string())?;
        let evidence = InterfaceCompilerExecutionQueryEvidence {
            query_name: crate::application::EXECUTION_READ_QUERY_NAME.to_string(),
            query_identity: result.receipt().query_identity().render_support_hex(),
            basis_version: result.receipt().basis_version().as_u64(),
            projected_record_count: result.receipt().projected_record_count(),
            projected_field_count: result.receipt().projected_field_count(),
            basis_released: result.receipt().basis_released(),
        };
        Ok((projection, evidence))
    }
}

fn validate_start_request(request: &InterfaceCompilerStartExecutionRequest) -> Result<(), String> {
    if request.execution_id.trim().is_empty() {
        return Err("execution_id must not be empty".to_string());
    }
    if request.credential.trim().is_empty() {
        return Err("credential must not be empty".to_string());
    }
    if request.timeout.is_zero() {
        return Err("timeout must be positive".to_string());
    }
    if request.timeout > MAX_REQUEST_TIMEOUT {
        return Err("timeout exceeds the host maximum".to_string());
    }
    if !matches!(
        request.execution_id.as_str(),
        super::DEMO_EXECUTION_ID
            | super::DEMO_EXECUTION_ID_TWO
            | super::DEMO_EXECUTION_NON_PENDING_ID
    ) {
        return Err(
            "this demo facade only accepts its three published execution identities".to_string(),
        );
    }
    Ok(())
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
