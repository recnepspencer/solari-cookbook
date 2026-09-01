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
                    DEMO_APPLICATION_BASE_URL.to_string(),
                ),
            )
            .map_err(|error| {
                InterfaceCompilerHostSetupError::from_stage("bind application entity", error)
            })?;
        // These are WORTH-owned capability and replay records. The consumer
        // contract names are intentionally semantic; the legacy portal labels
        // exist only in replay JSON and never in published tool metadata.
        for (capability_id, capability_name, capability_description, replay_id, replay_steps, verification_json) in [
            (
                ENRON_RESOLVE_CONTRACT_CAPABILITY_ID,
                "MarketResolveContract",
                "Resolve an approved wholesale energy contract from the desk catalog.",
                ENRON_RESOLVE_CONTRACT_REPLAY_ID,
                r#"[{"type":"read","instruction":"Resolve the approved Henry Hub next-month gas contract from the local contract catalog."}]"#,
                r#"{"requiredSuccessfulRuns":3,"runs":[{"id":"verification.enron.resolve-contract.1","capabilityId":"capability.enron.market.resolve-contract","replayVersionId":"replay.enron.market.resolve-contract.v1","sessionId":"solari.enron.catalog.1","freshSession":true,"outcome":"success","evidenceIds":["evidence.enron.resolve-contract.1"],"completedAt":"2026-09-01T01:00:00.000Z"},{"id":"verification.enron.resolve-contract.2","capabilityId":"capability.enron.market.resolve-contract","replayVersionId":"replay.enron.market.resolve-contract.v1","sessionId":"solari.enron.catalog.2","freshSession":true,"outcome":"success","evidenceIds":["evidence.enron.resolve-contract.2"],"completedAt":"2026-09-01T01:01:00.000Z"},{"id":"verification.enron.resolve-contract.3","capabilityId":"capability.enron.market.resolve-contract","replayVersionId":"replay.enron.market.resolve-contract.v1","sessionId":"solari.enron.catalog.3","freshSession":true,"outcome":"success","evidenceIds":["evidence.enron.resolve-contract.3"],"completedAt":"2026-09-01T01:02:00.000Z"}]}"#,
            ),
            (
                DEMO_CAPABILITY_ID,
                "TradesStageTrade",
                "Stage a resolved wholesale energy contract for review; it does not book a trade.",
                DEMO_REPLAY_ID,
                DEMO_REPLAY_STEPS_JSON,
                DEMO_REPLAY_VERIFICATION_JSON,
            ),
            (
                ENRON_RISK_APPROVAL_CAPABILITY_ID,
                "RiskRequestApproval",
                "Send a staged wholesale energy trade to independent risk review; it does not book a trade.",
                ENRON_RISK_APPROVAL_REPLAY_ID,
                r#"[{"type":"navigate","url":"http://127.0.0.1:4310/"},{"type":"click","target":{"semanticDescription":"risk approval","role":"button","name":"Send ticket to risk approval"}},{"type":"assert","condition":{"kind":"text_present","text":"PENDING_LIMIT_REVIEW"}}]"#,
                r#"{"requiredSuccessfulRuns":3,"runs":[{"id":"verification.enron.risk.1","capabilityId":"capability.enron.risk.request-approval","replayVersionId":"replay.enron.risk.request-approval.v1","sessionId":"solari.enron.risk.1","freshSession":true,"outcome":"success","evidenceIds":["evidence.enron.risk.1"],"completedAt":"2026-09-01T01:00:00.000Z"},{"id":"verification.enron.risk.2","capabilityId":"capability.enron.risk.request-approval","replayVersionId":"replay.enron.risk.request-approval.v1","sessionId":"solari.enron.risk.2","freshSession":true,"outcome":"success","evidenceIds":["evidence.enron.risk.2"],"completedAt":"2026-09-01T01:01:00.000Z"},{"id":"verification.enron.risk.3","capabilityId":"capability.enron.risk.request-approval","replayVersionId":"replay.enron.risk.request-approval.v1","sessionId":"solari.enron.risk.3","freshSession":true,"outcome":"success","evidenceIds":["evidence.enron.risk.3"],"completedAt":"2026-09-01T01:02:00.000Z"}]}"#,
            ),
        ] {
            graph
                .bind_entity(
                    primary_graph::WorthQueryApplicationEntitySeed::new(
                        Capability::reference(),
                        primary_graph::WorthQueryApplicationEntityKey::new(capability_id).map_err(|error| {
                            InterfaceCompilerHostSetupError::from_stage("create capability key", error)
                        })?,
                    )
                    .field(CapabilityIdentifier::reference(), capability_id.to_string())
                    .field(CapabilityRevision::reference(), DEMO_CAPABILITY_REVISION)
                    .field(CapabilityApplicationIdentifier::reference(), DEMO_APPLICATION_ID.to_string())
                    .field(CapabilityName::reference(), capability_name.to_string())
                    .field(CapabilityDescription::reference(), capability_description.to_string())
                    .field(CapabilityStatus::reference(), "healthy".to_string())
                    .field(CapabilityActiveReplayIdentifier::reference(), replay_id.to_string()),
                )
                .map_err(|error| InterfaceCompilerHostSetupError::from_stage("bind capability entity", error))?;
            graph
                .bind_entity(
                    primary_graph::WorthQueryApplicationEntitySeed::new(
                        Replay::reference(),
                        primary_graph::WorthQueryApplicationEntityKey::new(replay_id).map_err(|error| {
                            InterfaceCompilerHostSetupError::from_stage("create replay key", error)
                        })?,
                    )
                    .field(ReplayIdentifier::reference(), replay_id.to_string())
                    .field(ReplayRevision::reference(), DEMO_REPLAY_REVISION)
                    .field(ReplayCapabilityIdentifier::reference(), capability_id.to_string())
                    .field(ReplayVersion::reference(), 1_u64)
                    .field(ReplayStepsJson::reference(), replay_steps.to_string())
                    .field(ReplayConfidenceMillis::reference(), 1000_u64)
                    .field(ReplayStatus::reference(), "active".to_string())
                    .field(ReplayCreatedAt::reference(), "2026-09-01T00:00:00.000Z".to_string())
                    .field(ReplayDiscoveredFromExperimentIdentifier::reference(), "experiment.enron-online.initial-compilation".to_string())
                    .field(ReplayVerifiedAt::reference(), "2026-09-01T01:02:00.000Z".to_string())
                    .field(ReplayVerificationJson::reference(), verification_json.to_string()),
                )
                .map_err(|error| InterfaceCompilerHostSetupError::from_stage("bind replay entity", error))?;
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
                .field(ExecutionCapabilityIdentifier::reference(), DEMO_CAPABILITY_ID.to_string())
                .field(ExecutionReplayIdentifier::reference(), "".to_string())
                .field(ExecutionMode::reference(), "direct".to_string())
                .field(ExecutionStartMetricsJson::reference(), r#"{"startedAt":"2026-09-01T00:00:00.000Z","modelCalls":0,"inputTokens":0,"outputTokens":0,"browserObservations":0,"browserActions":0,"estimatedModelCostUsd":0.0}"#.to_string()),
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
                .field(ExecutionCapabilityIdentifier::reference(), DEMO_CAPABILITY_ID.to_string())
                .field(ExecutionReplayIdentifier::reference(), "".to_string())
                .field(ExecutionMode::reference(), "direct".to_string())
                .field(ExecutionStartMetricsJson::reference(), r#"{"startedAt":"2026-09-01T00:00:00.000Z","modelCalls":0,"inputTokens":0,"outputTokens":0,"browserObservations":0,"browserActions":0,"estimatedModelCostUsd":0.0}"#.to_string()),
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
                .field(ExecutionCapabilityIdentifier::reference(), DEMO_CAPABILITY_ID.to_string())
                .field(ExecutionReplayIdentifier::reference(), "".to_string())
                .field(ExecutionMode::reference(), "direct".to_string())
                .field(ExecutionStartMetricsJson::reference(), r#"{"startedAt":"2026-09-01T00:00:00.000Z","modelCalls":0,"inputTokens":0,"outputTokens":0,"browserObservations":0,"browserActions":0,"estimatedModelCostUsd":0.0}"#.to_string()),
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
