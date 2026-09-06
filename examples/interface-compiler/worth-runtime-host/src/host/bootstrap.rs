//! Construction of the in-memory WORTH-owned demonstration graph.

use std::sync::Arc;

use worth_query_host::facade::{admission, declaration, domain, primary_graph, runtime};

use super::*;

impl InterfaceCompilerWorthHost {
    /// Installs and publishes the small in-memory application graph through
    /// the production host facade. The in-memory graph is WORTH's backing for
    /// this demo, not an application-owned fallback store.
    pub fn in_memory_demo() -> Result<Self, InterfaceCompilerHostSetupError> {
        let base_url = demo_application_base_url_from_environment()?;
        Self::in_memory_demo_at(base_url)
    }

    /// The portal origin is private replay implementation data. It may change
    /// for a public live-demo tunnel without changing any semantic capability.
    pub fn in_memory_demo_at(
        application_base_url: impl Into<String>,
    ) -> Result<Self, InterfaceCompilerHostSetupError> {
        let application_base_url = validate_demo_application_base_url(application_base_url.into())?;
        let declaration = InterfaceCompilerSchema::declaration().map_err(|error| {
            InterfaceCompilerHostSetupError::from_stage("declare application schema", error)
        })?;
        let package = domain::WorthQueryPortableDomainPackage::new(
            domain::WorthQueryPortableDomainIdentity::new("interface_compiler_host", 1, 1),
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
        let query_resources = runtime::WorthQueryApplicationQueryResourceProfile::bounded(
            16 * 1024,
            QUERY_RESULT_BYTES,
            64 * 1024,
        )
        .map_err(|error| {
            InterfaceCompilerHostSetupError::from_stage(
                "configure bounded application query resources",
                error,
            )
        })?;
        let installation = runtime::WorthQueryExecutionRuntimeInstaller::new()
            .application_query_resources(query_resources)
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
                    application_base_url.clone(),
                ),
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("bind application entity", error)
            })?;
        // These are WORTH-owned capability and replay records. The consumer
        // contract names are intentionally semantic; the legacy portal labels
        // exist only in replay JSON and never in published tool metadata.
        for seed in demo_fixture::replays_for_base_url(&application_base_url) {
            let capability_id = seed.capability_id;
            let capability_name = seed.capability_name;
            let capability_description = seed.capability_description;
            let replay_id = seed.replay_id;
            graph
                .bind_entity(
                    primary_graph::WorthQueryApplicationEntitySeed::new(
                        Capability::reference(),
                        primary_graph::WorthQueryApplicationEntityKey::new(capability_id).map_err(
                            |error| {
                                InterfaceCompilerHostSetupError::from_stage(
                                    "create capability key",
                                    error,
                                )
                            },
                        )?,
                    )
                    .field(CapabilityIdentifier::reference(), capability_id.to_string())
                    .field(CapabilityRevision::reference(), DEMO_CAPABILITY_REVISION)
                    .field(
                        CapabilityApplicationIdentifier::reference(),
                        DEMO_APPLICATION_ID.to_string(),
                    )
                    .field(CapabilityName::reference(), capability_name.to_string())
                    .field(
                        CapabilityDescription::reference(),
                        capability_description.to_string(),
                    )
                    .field(
                        CapabilityInputSchemaJson::reference(),
                        seed.capability_input_schema_json.to_string(),
                    )
                    .field(
                        CapabilityOutputSchemaJson::reference(),
                        seed.capability_output_schema_json.to_string(),
                    )
                    .field(
                        CapabilityPreconditionsJson::reference(),
                        seed.capability_preconditions_json.to_string(),
                    )
                    .field(
                        CapabilityPostconditionsJson::reference(),
                        seed.capability_postconditions_json.to_string(),
                    )
                    .field(
                        CapabilityPublicationJson::reference(),
                        seed.capability_publication_json.to_string(),
                    )
                    .field(CapabilityStatus::reference(), "healthy".to_string())
                    .field(
                        CapabilityActiveReplayIdentifier::reference(),
                        replay_id.to_string(),
                    ),
                )
                .map_err(|error| {
                    InterfaceCompilerHostSetupError::from_stage("bind capability entity", error)
                })?;
            graph
                .bind_entity(
                    primary_graph::WorthQueryApplicationEntitySeed::new(
                        Replay::reference(),
                        primary_graph::WorthQueryApplicationEntityKey::new(replay_id).map_err(
                            |error| {
                                InterfaceCompilerHostSetupError::from_stage(
                                    "create replay key",
                                    error,
                                )
                            },
                        )?,
                    )
                    .field(ReplayIdentifier::reference(), replay_id.to_string())
                    .field(ReplayRevision::reference(), DEMO_REPLAY_REVISION)
                    .field(
                        ReplayCapabilityIdentifier::reference(),
                        capability_id.to_string(),
                    )
                    .field(ReplayVersion::reference(), 1_u64)
                    .field(ReplayStepsJson::reference(), seed.steps_json)
                    .field(ReplayConfidenceMillis::reference(), 1000_u64)
                    .field(ReplayStatus::reference(), "active".to_string())
                    .field(
                        ReplayCreatedAt::reference(),
                        "2026-09-01T00:00:00.000Z".to_string(),
                    )
                    .field(
                        ReplayDiscoveredFromExperimentIdentifier::reference(),
                        "experiment.enron-online.initial-compilation".to_string(),
                    )
                    .field(
                        ReplayVerifiedAt::reference(),
                        "2026-09-01T01:02:00.000Z".to_string(),
                    )
                    .field(
                        ReplayVerificationJson::reference(),
                        seed.verification_json.to_string(),
                    ),
                )
                .map_err(|error| {
                    InterfaceCompilerHostSetupError::from_stage("bind replay entity", error)
                })?;
        }
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
                )
                .field(ExecutionRevision::reference(), 0_u64)
                .field(ExecutionSettlementJson::reference(), "null".to_string())
                .field(
                    ExecutionCapabilityIdentifier::reference(),
                    DEMO_CAPABILITY_ID.to_string(),
                )
                .field(ExecutionReplayIdentifier::reference(), "".to_string())
                .field(ExecutionMode::reference(), "direct".to_string())
                .field(
                    ExecutionStartMetricsJson::reference(),
                    demo_fixture::EXECUTION_START_METRICS_JSON
                        .trim()
                        .to_string(),
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
                )
                .field(ExecutionRevision::reference(), 0_u64)
                .field(ExecutionSettlementJson::reference(), "null".to_string())
                .field(
                    ExecutionCapabilityIdentifier::reference(),
                    DEMO_CAPABILITY_ID.to_string(),
                )
                .field(ExecutionReplayIdentifier::reference(), "".to_string())
                .field(ExecutionMode::reference(), "direct".to_string())
                .field(
                    ExecutionStartMetricsJson::reference(),
                    demo_fixture::EXECUTION_START_METRICS_JSON
                        .trim()
                        .to_string(),
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
                    DEMO_EXECUTION_STARTED.to_string(),
                )
                .field(ExecutionRevision::reference(), 1_u64)
                .field(ExecutionSettlementJson::reference(), "null".to_string())
                .field(
                    ExecutionCapabilityIdentifier::reference(),
                    DEMO_CAPABILITY_ID.to_string(),
                )
                .field(ExecutionReplayIdentifier::reference(), "".to_string())
                .field(ExecutionMode::reference(), "direct".to_string())
                .field(
                    ExecutionStartMetricsJson::reference(),
                    demo_fixture::EXECUTION_START_METRICS_JSON
                        .trim()
                        .to_string(),
                ),
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage(
                    "bind non-pending execution entity",
                    error,
                )
            })?;
        graph
            .bind_entity(
                primary_graph::WorthQueryApplicationEntitySeed::new(
                    EventJournal::reference(),
                    primary_graph::WorthQueryApplicationEntityKey::new(DEMO_EVENT_JOURNAL_ID)
                        .map_err(|error| {
                            InterfaceCompilerHostSetupError::from_stage(
                                "create event journal key",
                                error,
                            )
                        })?,
                )
                .field(
                    EventJournalIdentifier::reference(),
                    DEMO_EVENT_JOURNAL_ID.to_string(),
                )
                .field(EventJournalRevision::reference(), 0_u64)
                .field(EventJournalEventsJson::reference(), "[]".to_string()),
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("bind event journal entity", error)
            })?;
        for execution_id in [
            DEMO_EXECUTION_ID,
            DEMO_EXECUTION_ID_TWO,
            DEMO_EXECUTION_NON_PENDING_ID,
        ] {
            let execution_journal = super::execution_admission::execution_journal_id(execution_id);
            graph
                .bind_entity(
                    primary_graph::WorthQueryApplicationEntitySeed::new(
                        EventJournal::reference(),
                        primary_graph::WorthQueryApplicationEntityKey::new(
                            execution_journal.clone(),
                        )
                        .map_err(|error| {
                            InterfaceCompilerHostSetupError::from_stage(
                                "create started execution journal key",
                                error,
                            )
                        })?,
                    )
                    .field(EventJournalIdentifier::reference(), execution_journal)
                    .field(EventJournalRevision::reference(), 0_u64)
                    .field(EventJournalEventsJson::reference(), "[]".to_string()),
                )
                .map_err(|error| {
                    InterfaceCompilerHostSetupError::from_stage(
                        "bind started execution journal entity",
                        error,
                    )
                })?;
        }
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
