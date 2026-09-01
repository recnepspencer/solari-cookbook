//! One application-specific execution lifecycle transition owned by WORTH.

use std::time::{Duration, Instant};

use worth_query_host::facade::{admission, declaration, primary_graph};

use super::{block_on, InterfaceCompilerWorthHost, MAX_REQUEST_TIMEOUT};
use crate::application::{
    execution_id_parameter, ExecutionIdentifier, ExecutionLifecycle, ExecutionReadQuery,
    InterfaceCompilerExecutionProjection, StartExecution,
};

const EXECUTION_QUERY_RESULT_LIMIT: usize = 1;
const EXECUTION_QUERY_RESULT_BYTES: usize = 4 * 1024;
const START_EXECUTION_IDEMPOTENCY_KEY: [u8; 32] = [0x51; 32];
const START_EXECUTION_INTENT: [u8; 32] = [0xA7; 32];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerStartExecutionRequest {
    pub execution_id: String,
    pub credential: String,
    pub timeout: Duration,
}

impl InterfaceCompilerStartExecutionRequest {
    pub fn new(
        execution_id: impl Into<String>,
        credential: impl Into<String>,
        timeout: Duration,
    ) -> Self {
        Self {
            execution_id: execution_id.into(),
            credential: credential.into(),
            timeout,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerExecutionCommitKind {
    Committed,
    AlreadyCommitted,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerExecutionQueryEvidence {
    pub query_name: String,
    pub query_identity: String,
    pub basis_version: u64,
    pub projected_record_count: usize,
    pub projected_field_count: usize,
    pub basis_released: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerStartExecutionOutcome {
    Transitioned {
        commit: InterfaceCompilerExecutionCommitKind,
        projection: InterfaceCompilerExecutionProjection,
        evidence: InterfaceCompilerExecutionQueryEvidence,
    },
    Denied {
        stage: InterfaceCompilerStartExecutionDenialStage,
        detail: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerStartExecutionDenialStage {
    Request,
    Authentication,
    PrincipalResolution,
    EntityResolution,
    OperationAdmission,
    DependencyProjection,
    EffectProgram,
    Commit,
    Query,
}

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
        let external = match block_on(
            self.authentication
                .authenticate(request.credential.clone(), &scope),
        ) {
            Ok(external) => external,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::Authentication,
                    format!("{:?}", error.kind()),
                )
            }
        };
        let principal = match self.application.resolve_authenticated_principal(
            &self.principal_binding,
            external,
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(principal) => principal,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::PrincipalResolution,
                    format!("{:?}", error.kind()),
                )
            }
        };
        let execution = match self.application.resolve_entity(
            ExecutionIdentifier::reference(),
            request.execution_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(execution) => execution,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::EntityResolution,
                    format!("{:?}", error.kind()),
                )
            }
        };
        let operation = match self
            .application
            .installed_schema()
            .installed_operation(StartExecution::reference())
        {
            Ok(operation) => operation,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::OperationAdmission,
                    format!("operation is not installed: {error:?}"),
                )
            }
        };
        let admission = match self.application.authorize_operation(
            &principal,
            &execution,
            &operation,
            Default::default(),
            &scope,
        ) {
            Ok(admission) => admission,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::OperationAdmission,
                    format!("{error:?}"),
                )
            }
        };
        let (_, projection, _) =
            match self
                .invariant
                .project_admitted_operation(&admission, |reader, scope| {
                    reader
                        .decision_field(scope, ExecutionIdentifier::reference())
                        .expect("the installed operation admits its execution identity read");
                    reader
                        .decision_field(scope, ExecutionLifecycle::reference())
                        .expect("the installed operation admits its execution lifecycle read");
                }) {
                Ok(projected) => projected.into_parts(),
                Err(error) => {
                    return denied(
                        InterfaceCompilerStartExecutionDenialStage::DependencyProjection,
                        format!("{error:?}"),
                    )
                }
            };
        let reads = match self
            .application
            .begin_projected_application_read_attempt(admission, projection)
        {
            Ok(reads) => reads,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::DependencyProjection,
                    format!("{error:?}"),
                )
            }
        };
        let dependencies = match reads.complete_projected_dependencies() {
            Ok(dependencies) => dependencies,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::DependencyProjection,
                    format!("{error:?}"),
                )
            }
        };
        let mut effects = dependencies.begin_effect_program();
        let execution_effect = match effects.existing_entity(&execution) {
            Ok(execution) => execution,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                    format!("{error:?}"),
                )
            }
        };
        if let Err(error) = effects.write_field(
            &execution_effect,
            ExecutionLifecycle::reference(),
            super::DEMO_EXECUTION_STARTED.to_string(),
        ) {
            return denied(
                InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                format!("{error:?}"),
            );
        }
        let program = match effects.finish() {
            Ok(program) => program,
            Err(error) => {
                return denied(
                    InterfaceCompilerStartExecutionDenialStage::EffectProgram,
                    format!("{error:?}"),
                )
            }
        };
        let binding = primary_graph::WorthQueryApplicationIdempotencyBinding::new(
            START_EXECUTION_IDEMPOTENCY_KEY,
            START_EXECUTION_INTENT,
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
                    format!("{outcome:?}"),
                )
            }
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

    fn query_execution(
        &self,
        principal: &primary_graph::WorthQueryAuthenticatedPrincipal<
            crate::application::InterfaceCompilerSchema,
            crate::application::Principal,
            u64,
        >,
        execution: &primary_graph::WorthQueryApplicationEntityIdentity<
            crate::application::InterfaceCompilerSchema,
            crate::application::Execution,
        >,
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
