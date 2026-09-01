//! Application-specific composition of the public WORTH Query host facade.

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use worth_query_host::facade::{admission, declaration, domain, primary_graph};

use crate::application::{
    application_id_parameter, Application, ApplicationBaseUrl, ApplicationIdentifier,
    ApplicationName, ApplicationReadQuery, ApplicationRevision, Capability,
    CapabilityActiveReplayIdentifier, CapabilityApplicationIdentifier, CapabilityDescription,
    CapabilityIdentifier, CapabilityName, CapabilityRevision, CapabilityStatus, EventJournal,
    EventJournalEventsJson, EventJournalIdentifier, EventJournalRevision, Execution,
    ExecutionIdentifier, ExecutionLifecycle, ExecutionRevision, ExecutionSettlementJson,
    InterfaceCompilerApplicationProjection, InterfaceCompilerPrincipalBinding,
    InterfaceCompilerSchema, Replay, ReplayCapabilityIdentifier, ReplayConfidenceMillis,
    ReplayCreatedAt, ReplayIdentifier, ReplayRevision, ReplayStatus, ReplayStepsJson,
    ReplayVerificationJson, ReplayVerifiedAt, ReplayVersion,
};

mod bootstrap;
mod compiled_plan_read;
pub use compiled_plan_read::*;
mod execution;
mod execution_contract;
mod execution_idempotency;
mod settlement;
mod settlement_query;
mod settlement_support;
pub use settlement::*;
mod synchronous_future;
pub use execution_contract::*;
use synchronous_future::block_on;

pub const DEMO_APPLICATION_ID: &str = "application.interface-compiler";
pub const DEMO_APPLICATION_REVISION: u64 = 7;
pub const DEMO_APPLICATION_NAME: &str = "Interface Compiler Demo";
pub const DEMO_APPLICATION_BASE_URL: &str = "https://interface-compiler.example";
pub const DEMO_CAPABILITY_ID: &str = "capability.walmart.search-products";
pub const DEMO_REPLAY_ID: &str = "replay.walmart.search-products.v1";
pub const DEMO_CAPABILITY_REVISION: u64 = 3;
pub const DEMO_REPLAY_REVISION: u64 = 5;
pub const DEMO_CREDENTIAL: &str = "interface-compiler-demo";
pub const DEMO_EXECUTION_ID: &str = "execution.demonstration-001";
pub const DEMO_EXECUTION_ID_TWO: &str = "execution.demonstration-002";
pub const DEMO_EXECUTION_NON_PENDING_ID: &str = "execution.demonstration-started";
pub const DEMO_EXECUTION_PENDING: &str = "pending";
pub const DEMO_EXECUTION_STARTED: &str = "started";
pub const DEMO_EVENT_JOURNAL_ID: &str = "event-journal.interface-compiler";
pub const DEMO_REPLAY_STEPS_JSON: &str = r#"[{"type":"navigate","url":"https://www.walmart.com/"},{"type":"fill","target":{"semanticDescription":"product search","role":"searchbox"},"value":"Tide Pods"},{"type":"click","target":{"semanticDescription":"submit product search","role":"button","name":"Search"}}]"#;
pub const DEMO_REPLAY_VERIFICATION_JSON: &str = r#"{"requiredSuccessfulRuns":1,"runs":[{"id":"verification.search-products.1","capabilityId":"capability.walmart.search-products","replayVersionId":"replay.walmart.search-products.v1","sessionId":"solari.demo.fresh.1","freshSession":true,"outcome":"success","evidenceIds":["evidence.search-products.1"],"completedAt":"2026-08-31T18:00:00.000Z"}]}"#;
pub const DEMO_PRINCIPAL_KEY: &str = "principal.interface-compiler-demo";
pub const DEMO_PRINCIPAL_SUBJECT: &str = "interface-compiler-demo";
pub const DEMO_PRINCIPAL_ISSUER: &str = "https://interface-compiler.example/issuer";
pub const DEMO_AUTHENTICATION_AUDIENCE: &str = "interface-compiler-host";
pub const DEMO_AUTHENTICATION_METHOD: &str = "demo-credential";
pub const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

const QUERY_RESULT_LIMIT: usize = 1;
const QUERY_RESULT_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerApplicationReadRequest {
    pub application_id: String,
    pub credential: String,
    pub timeout: Duration,
}

impl InterfaceCompilerApplicationReadRequest {
    pub fn new(
        application_id: impl Into<String>,
        credential: impl Into<String>,
        timeout: Duration,
    ) -> Self {
        Self {
            application_id: application_id.into(),
            credential: credential.into(),
            timeout,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerApplicationReadInvalidRequest {
    EmptyApplicationId,
    EmptyCredential,
    TimeoutMustBePositive,
    TimeoutExceedsMaximum,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerApplicationReadDenial {
    InvalidRequest(InterfaceCompilerApplicationReadInvalidRequest),
    Authentication(admission::authenticated_principal::WorthQueryAuthenticationDenialKind),
    PrincipalResolution(primary_graph::WorthQueryPrincipalResolutionDenialKind),
    EntityResolution(primary_graph::WorthQueryEntityResolutionDenialKind),
    QueryNotInstalled,
    QueryAdmission(primary_graph::WorthQueryApplicationQueryAdmissionDenialKind),
    QueryExecution(primary_graph::WorthQueryApplicationOneShotDenialKind),
    Projection(primary_graph::WorthQueryApplicationProjectionDenialKind),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerApplicationReadEvidence {
    pub query_name: String,
    pub query_identity: String,
    pub basis_version: u64,
    pub projected_record_count: usize,
    pub projected_field_count: usize,
    pub basis_released: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerApplicationReadOutcome {
    Found {
        projection: InterfaceCompilerApplicationProjection,
        evidence: InterfaceCompilerApplicationReadEvidence,
    },
    NotFound {
        application_id: String,
    },
    Denied {
        application_id: String,
        denial: InterfaceCompilerApplicationReadDenial,
    },
}

#[derive(Debug)]
pub struct InterfaceCompilerHostSetupError {
    message: String,
}

impl InterfaceCompilerHostSetupError {
    fn from_stage(stage: &str, error: impl std::fmt::Debug) -> Self {
        Self {
            message: format!("{stage}: {error:?}"),
        }
    }
}

impl std::fmt::Display for InterfaceCompilerHostSetupError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for InterfaceCompilerHostSetupError {}

type InstalledPrincipalBinding = domain::WorthQueryInstalledPrincipalBinding<
    InterfaceCompilerSchema,
    InterfaceCompilerPrincipalBinding,
    crate::application::ExternalMapping,
    crate::application::Principal,
    u64,
>;

type AdmittedDemoAuthentication =
    admission::authenticated_principal::WorthQueryAdmittedAuthenticationAdapter<
        InterfaceCompilerSchema,
        DemoAuthenticationAdapter,
    >;

/// The live WORTH-backed host. It owns the WORTH runtime-local graph and the
/// admitted authentication adapter; no graph handle or recovery handle is
/// serialized or exposed to the client.
pub struct InterfaceCompilerWorthHost {
    application: primary_graph::WorthQueryPrimaryGraphApplicationRuntime<InterfaceCompilerSchema>,
    invariant: Arc<
        primary_graph::WorthQueryApplicationInvariantProjectionAuthority<InterfaceCompilerSchema>,
    >,
    principal_binding: InstalledPrincipalBinding,
    authentication: AdmittedDemoAuthentication,
}

impl InterfaceCompilerWorthHost {
    pub fn read_application(
        &self,
        request: InterfaceCompilerApplicationReadRequest,
    ) -> InterfaceCompilerApplicationReadOutcome {
        if let Err(reason) = validate_request(&request) {
            return InterfaceCompilerApplicationReadOutcome::Denied {
                application_id: request.application_id,
                denial: InterfaceCompilerApplicationReadDenial::InvalidRequest(reason),
            };
        }

        let cancellation = admission::authenticated_principal::WorthQueryCancellationSource::new();
        let scope = admission::authenticated_principal::WorthQueryRequestScope::new(
            Instant::now() + request.timeout,
            cancellation.token(),
        );
        let external = match block_on(self.authentication.authenticate(request.credential, &scope))
        {
            Ok(external) => external,
            Err(denial) => {
                return InterfaceCompilerApplicationReadOutcome::Denied {
                    application_id: request.application_id,
                    denial: InterfaceCompilerApplicationReadDenial::Authentication(denial.kind()),
                }
            }
        };
        let principal = match self.application.resolve_authenticated_principal(
            &self.principal_binding,
            external,
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(principal) => principal,
            Err(denial) => {
                return InterfaceCompilerApplicationReadOutcome::Denied {
                    application_id: request.application_id,
                    denial: InterfaceCompilerApplicationReadDenial::PrincipalResolution(
                        denial.kind(),
                    ),
                }
            }
        };
        let application_identity = match self.application.resolve_entity(
            ApplicationIdentifier::reference(),
            request.application_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(identity) => identity,
            Err(denial)
                if denial.kind()
                    == primary_graph::WorthQueryEntityResolutionDenialKind::UnknownEntity =>
            {
                return InterfaceCompilerApplicationReadOutcome::NotFound {
                    application_id: request.application_id,
                }
            }
            Err(denial) => {
                return InterfaceCompilerApplicationReadOutcome::Denied {
                    application_id: request.application_id,
                    denial: InterfaceCompilerApplicationReadDenial::EntityResolution(denial.kind()),
                }
            }
        };
        let query = match self
            .application
            .installed_schema()
            .application_query(ApplicationReadQuery::reference())
        {
            Ok(query) => query,
            Err(_) => {
                return InterfaceCompilerApplicationReadOutcome::Denied {
                    application_id: request.application_id,
                    denial: InterfaceCompilerApplicationReadDenial::QueryNotInstalled,
                }
            }
        };
        let access = primary_graph::WorthQueryApplicationQueryAccessContext::new(
            &principal,
            &application_identity,
        );
        let plan = match self.application.admit_application_query(
            &query,
            &access,
            declaration::application_query::ApplicationQueryParameterSet::new()
                .bind(application_id_parameter(), request.application_id.clone()),
            primary_graph::WorthQueryApplicationQueryControls::current_one_shot(
                std::num::NonZeroUsize::new(QUERY_RESULT_LIMIT)
                    .expect("the demo query result limit is non-zero"),
                std::num::NonZeroUsize::new(QUERY_RESULT_BYTES)
                    .expect("the demo query byte limit is non-zero"),
                &scope,
            ),
        ) {
            Ok(plan) => plan,
            Err(denial) => {
                return InterfaceCompilerApplicationReadOutcome::Denied {
                    application_id: request.application_id,
                    denial: InterfaceCompilerApplicationReadDenial::QueryAdmission(denial.kind()),
                }
            }
        };
        let result = match self.application.execute_application_query_one_shot(plan) {
            Ok(result) => result,
            Err(denial) => {
                let denial = match denial.kind() {
                    primary_graph::WorthQueryApplicationOneShotDenialKind::Projection(kind) => {
                        InterfaceCompilerApplicationReadDenial::Projection(kind)
                    }
                    kind => InterfaceCompilerApplicationReadDenial::QueryExecution(kind),
                };
                return InterfaceCompilerApplicationReadOutcome::Denied {
                    application_id: request.application_id,
                    denial,
                };
            }
        };
        let Some(projection) = result.rows().first().cloned() else {
            return InterfaceCompilerApplicationReadOutcome::Denied {
                application_id: request.application_id,
                denial: InterfaceCompilerApplicationReadDenial::QueryExecution(
                    primary_graph::WorthQueryApplicationOneShotDenialKind::CardinalityMismatch,
                ),
            };
        };
        let evidence = InterfaceCompilerApplicationReadEvidence {
            query_name: crate::application::APPLICATION_READ_QUERY_NAME.to_string(),
            query_identity: result.receipt().query_identity().render_support_hex(),
            basis_version: result.receipt().basis_version().as_u64(),
            projected_record_count: result.receipt().projected_record_count(),
            projected_field_count: result.receipt().projected_field_count(),
            basis_released: result.receipt().basis_released(),
        };
        InterfaceCompilerApplicationReadOutcome::Found {
            projection: InterfaceCompilerApplicationProjection {
                id: projection.id,
                revision: projection.revision,
                name: projection.name,
                base_url: projection.base_url,
            },
            evidence,
        }
    }
}

fn validate_request(
    request: &InterfaceCompilerApplicationReadRequest,
) -> Result<(), InterfaceCompilerApplicationReadInvalidRequest> {
    if request.application_id.trim().is_empty() {
        return Err(InterfaceCompilerApplicationReadInvalidRequest::EmptyApplicationId);
    }
    if request.credential.trim().is_empty() {
        return Err(InterfaceCompilerApplicationReadInvalidRequest::EmptyCredential);
    }
    if request.timeout.is_zero() {
        return Err(InterfaceCompilerApplicationReadInvalidRequest::TimeoutMustBePositive);
    }
    if request.timeout > MAX_REQUEST_TIMEOUT {
        return Err(InterfaceCompilerApplicationReadInvalidRequest::TimeoutExceedsMaximum);
    }
    Ok(())
}

struct DemoAuthenticationAdapter;

impl admission::authenticated_principal::WorthQueryAuthenticationAdapter
    for DemoAuthenticationAdapter
{
    type Credential = String;

    fn configuration_identity(&self) -> &str {
        "interface-compiler-demo-authentication-v1"
    }

    fn validate<'a>(
        &'a self,
        credential: Self::Credential,
        _scope: &'a admission::authenticated_principal::WorthQueryRequestScope,
    ) -> admission::authenticated_principal::WorthQueryAuthenticationFuture<'a> {
        Box::pin(async move {
            if credential != DEMO_CREDENTIAL {
                return Err(
                    admission::authenticated_principal::WorthQueryAuthenticationAdapterFailure::new(
                        admission::authenticated_principal::WorthQueryAuthenticationAdapterFailureKind::CredentialRejected,
                    ),
                );
            }
            let now = SystemTime::now();
            let identity = declaration::authentication::WorthQueryExternalPrincipalIdentity::new(
                DEMO_PRINCIPAL_ISSUER,
                DEMO_PRINCIPAL_SUBJECT,
            )
            .map_err(|_| {
                admission::authenticated_principal::WorthQueryAuthenticationAdapterFailure::new(
                    admission::authenticated_principal::WorthQueryAuthenticationAdapterFailureKind::ProtocolViolation,
                )
            })?;
            let audience = admission::authenticated_principal::WorthQueryAuthenticationAudience::new(
                DEMO_AUTHENTICATION_AUDIENCE,
            )
            .map_err(|_| {
                admission::authenticated_principal::WorthQueryAuthenticationAdapterFailure::new(
                    admission::authenticated_principal::WorthQueryAuthenticationAdapterFailureKind::ProtocolViolation,
                )
            })?;
            let method = admission::authenticated_principal::WorthQueryAuthenticationMethod::new(
                DEMO_AUTHENTICATION_METHOD,
            )
            .map_err(|_| {
                admission::authenticated_principal::WorthQueryAuthenticationAdapterFailure::new(
                    admission::authenticated_principal::WorthQueryAuthenticationAdapterFailureKind::ProtocolViolation,
                )
            })?;
            admission::authenticated_principal::WorthQueryValidatedExternalPrincipal::new(
                identity,
                audience,
                method,
                now,
                now + Duration::from_secs(3600),
                Vec::new(),
            )
            .map_err(|_| {
                admission::authenticated_principal::WorthQueryAuthenticationAdapterFailure::new(
                    admission::authenticated_principal::WorthQueryAuthenticationAdapterFailureKind::ProtocolViolation,
                )
            })
        })
    }
}
