//! Construction of the in-memory WORTH-owned demonstration graph.

use std::sync::Arc;

use worth_query_host::facade::{admission, declaration, domain, primary_graph, runtime};

use super::*;

impl InterfaceCompilerWorthHost {
    /// Installs and publishes the small in-memory application graph through
    /// the production host facade. The in-memory graph is WORTH's backing for
    /// this demo, not an application-owned fallback store.
    pub fn in_memory_demo() -> Result<Self, InterfaceCompilerHostSetupError> {
        let declaration = InterfaceCompilerSchema::declaration().map_err(|error| {
            InterfaceCompilerHostSetupError::from_stage("declare application schema", error)
        })?;
        let package = domain::WorthQueryPortableDomainPackage::new(
            domain::WorthQueryPortableDomainIdentity::new("interface_compiler_host", 1, 0),
        )
        .application_schema(declaration.clone())
        .validate()
        .map_err(|error| {
            InterfaceCompilerHostSetupError::from_stage("validate application package", error)
        })?;
        let admitted = domain::WorthQueryInstallationAdmissionProfile::new(
            "interface-compiler-host",
            "worth-query-demo",
        )
        .admit(package)
        .map_err(|error| {
            InterfaceCompilerHostSetupError::from_stage("admit application package", error)
        })?;
        let installation = runtime::WorthQueryExecutionRuntimeInstaller::new()
            .install(
                domain::WorthQueryInstallationGeneration::initial(),
                [admitted],
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("install WORTH runtime", error)
            })?;
        let (runtime, authority) = installation.into_parts();
        let schema = runtime
            .installed_packages()
            .bind_application_schema(declaration)
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("bind installed schema", error)
            })?;
        let principal_binding = schema
            .principal_binding(InterfaceCompilerPrincipalBinding::reference())
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("bind principal admission", error)
            })?;
        let authentication = admission::authenticated_principal::admit_authentication_adapter(
            &schema,
            admission::authenticated_principal::WorthQueryAuthenticationAdapterAdmission::new(
                admission::authenticated_principal::WorthQueryAuthenticationAudience::new(
                    DEMO_AUTHENTICATION_AUDIENCE,
                )
                .map_err(|error| {
                    InterfaceCompilerHostSetupError::from_stage(
                        "configure authentication audience",
                        error,
                    )
                })?,
                admission::authenticated_principal::WorthQueryAuthenticationMethod::new(
                    DEMO_AUTHENTICATION_METHOD,
                )
                .map_err(|error| {
                    InterfaceCompilerHostSetupError::from_stage(
                        "configure authentication method",
                        error,
                    )
                })?,
            ),
            DemoAuthenticationAdapter,
        )
        .map_err(|error| {
            InterfaceCompilerHostSetupError::from_stage("admit authentication adapter", error)
        })?;
        let mut graph = authority
            .prepare_primary_graph(&runtime, &schema)
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("prepare WORTH primary graph", error)
            })?;
        graph
            .bind_principal(
                &principal_binding,
                primary_graph::WorthQueryApplicationPrincipalKey::new(DEMO_PRINCIPAL_KEY).map_err(
                    |error| {
                        InterfaceCompilerHostSetupError::from_stage("create principal key", error)
                    },
                )?,
                1_u64,
                declaration::authentication::WorthQueryExternalPrincipalIdentity::new(
                    DEMO_PRINCIPAL_ISSUER,
                    DEMO_PRINCIPAL_SUBJECT,
                )
                .map_err(|error| {
                    InterfaceCompilerHostSetupError::from_stage("create principal identity", error)
                })?,
                declaration::authentication::WorthQueryPrincipalMappingStatus::Enabled,
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("bind principal mapping", error)
            })?;
        graph
            .bind_entity(
                primary_graph::WorthQueryApplicationEntitySeed::new(
                    Application::reference(),
                    primary_graph::WorthQueryApplicationEntityKey::new(DEMO_APPLICATION_ID)
                        .map_err(|error| {
                            InterfaceCompilerHostSetupError::from_stage(
                                "create application key",
                                error,
                            )
                        })?,
                )
                .field(
                    ApplicationIdentifier::reference(),
                    DEMO_APPLICATION_ID.to_string(),
                )
                .field(ApplicationRevision::reference(), DEMO_APPLICATION_REVISION)
                .field(
                    ApplicationName::reference(),
                    DEMO_APPLICATION_NAME.to_string(),
                )
                .field(
                    ApplicationBaseUrl::reference(),
                    DEMO_APPLICATION_BASE_URL.to_string(),
                ),
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("bind application entity", error)
            })?;
        graph
            .bind_entity(
                primary_graph::WorthQueryApplicationEntitySeed::new(
                    Execution::reference(),
                    primary_graph::WorthQueryApplicationEntityKey::new(DEMO_EXECUTION_ID).map_err(
                        |error| {
                            InterfaceCompilerHostSetupError::from_stage(
                                "create execution key",
                                error,
                            )
                        },
                    )?,
                )
                .field(
                    ExecutionIdentifier::reference(),
                    DEMO_EXECUTION_ID.to_string(),
                )
                .field(
                    ExecutionLifecycle::reference(),
                    DEMO_EXECUTION_PENDING.to_string(),
                ),
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("bind execution entity", error)
            })?;
        graph
            .bind_entity(
                primary_graph::WorthQueryApplicationEntitySeed::new(
                    Execution::reference(),
                    primary_graph::WorthQueryApplicationEntityKey::new(DEMO_EXECUTION_ID_TWO)
                        .map_err(|error| {
                            InterfaceCompilerHostSetupError::from_stage(
                                "create second execution key",
                                error,
                            )
                        })?,
                )
                .field(
                    ExecutionIdentifier::reference(),
                    DEMO_EXECUTION_ID_TWO.to_string(),
                )
                .field(
                    ExecutionLifecycle::reference(),
                    DEMO_EXECUTION_PENDING.to_string(),
                ),
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("bind second execution entity", error)
            })?;
        graph
            .bind_entity(
                primary_graph::WorthQueryApplicationEntitySeed::new(
                    Execution::reference(),
                    primary_graph::WorthQueryApplicationEntityKey::new(
                        DEMO_EXECUTION_NON_PENDING_ID,
                    )
                    .map_err(|error| {
                        InterfaceCompilerHostSetupError::from_stage(
                            "create non-pending execution key",
                            error,
                        )
                    })?,
                )
                .field(
                    ExecutionIdentifier::reference(),
                    DEMO_EXECUTION_NON_PENDING_ID.to_string(),
                )
                .field(
                    ExecutionLifecycle::reference(),
                    DEMO_EXECUTION_COMPLETED.to_string(),
                ),
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage(
                    "bind non-pending execution entity",
                    error,
                )
            })?;
        let invariant = Arc::new(graph.retain_invariant_projection_authority());
        let application = graph
            .publish_application_runtime(runtime, authority, schema)
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage(
                    "publish WORTH application runtime",
                    error,
                )
            })?;
        Ok(Self {
            application,
            invariant,
            principal_binding,
            authentication,
        })
    }
}
