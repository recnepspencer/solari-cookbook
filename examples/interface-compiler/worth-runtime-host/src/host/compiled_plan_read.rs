//! WORTH-owned capability and active-replay reads.

use super::{
    block_on, InterfaceCompilerApplicationReadEvidence, InterfaceCompilerWorthHost,
    MAX_REQUEST_TIMEOUT, QUERY_RESULT_BYTES, QUERY_RESULT_LIMIT,
};
use crate::application::*;
use std::time::{Duration, Instant};
use worth_query_host::facade::{admission, declaration, primary_graph};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerCompiledReadRequest {
    pub capability_id: String,
    pub credential: String,
    pub timeout: Duration,
}
impl InterfaceCompilerCompiledReadRequest {
    pub fn new(
        capability_id: impl Into<String>,
        credential: impl Into<String>,
        timeout: Duration,
    ) -> Self {
        Self {
            capability_id: capability_id.into(),
            credential: credential.into(),
            timeout,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerCompiledReadDenial {
    InvalidRequest,
    Authentication(String),
    PrincipalResolution(String),
    EntityResolution(String),
    QueryNotInstalled,
    QueryAdmission(String),
    QueryExecution(String),
    Projection(String),
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerCapabilityReadOutcome {
    Found {
        projection: InterfaceCompilerCapabilityProjection,
        evidence: InterfaceCompilerApplicationReadEvidence,
    },
    NotFound {
        capability_id: String,
    },
    Denied {
        capability_id: String,
        denial: InterfaceCompilerCompiledReadDenial,
    },
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerActiveReplayReadOutcome {
    Found {
        projection: InterfaceCompilerActiveReplayProjection,
        evidence: InterfaceCompilerApplicationReadEvidence,
    },
    NotFound {
        capability_id: String,
    },
    Denied {
        capability_id: String,
        denial: InterfaceCompilerCompiledReadDenial,
    },
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterfaceCompilerReplayReadRequest {
    pub capability_id: String,
    pub replay_id: String,
    pub credential: String,
    pub timeout: Duration,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerReplayReadOutcome {
    Found {
        projection: InterfaceCompilerActiveReplayProjection,
        evidence: InterfaceCompilerApplicationReadEvidence,
    },
    NotFound {
        replay_id: String,
    },
    Denied {
        replay_id: String,
        denial: InterfaceCompilerCompiledReadDenial,
    },
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InterfaceCompilerRecoveryProjectionReadOutcome {
    Found {
        capability: InterfaceCompilerCapabilityProjection,
        capability_evidence: InterfaceCompilerApplicationReadEvidence,
        replay: InterfaceCompilerActiveReplayProjection,
        replay_evidence: InterfaceCompilerApplicationReadEvidence,
    },
    NotFound {
        capability_id: String,
    },
    Denied {
        capability_id: String,
        denial: InterfaceCompilerCompiledReadDenial,
    },
}

impl InterfaceCompilerWorthHost {
    pub fn read_recovery_projection(
        &self,
        capability_request: InterfaceCompilerCompiledReadRequest,
    ) -> InterfaceCompilerRecoveryProjectionReadOutcome {
        let started_at = Instant::now();
        let capability_id = capability_request.capability_id.clone();
        let capability = match self.read_capability(capability_request.clone()) {
            InterfaceCompilerCapabilityReadOutcome::Found {
                projection,
                evidence,
            } => (projection, evidence),
            InterfaceCompilerCapabilityReadOutcome::NotFound { capability_id } => {
                return InterfaceCompilerRecoveryProjectionReadOutcome::NotFound { capability_id }
            }
            InterfaceCompilerCapabilityReadOutcome::Denied {
                capability_id,
                denial,
            } => {
                return InterfaceCompilerRecoveryProjectionReadOutcome::Denied {
                    capability_id,
                    denial,
                }
            }
        };
        let Some(remaining) = capability_request.timeout.checked_sub(started_at.elapsed()) else {
            return InterfaceCompilerRecoveryProjectionReadOutcome::Denied {
                capability_id,
                denial: InterfaceCompilerCompiledReadDenial::QueryAdmission(
                    "recovery_projection_deadline_elapsed".to_string(),
                ),
            };
        };
        let Some(replay_id) = recovery_replay_id(&capability.0).map(str::to_owned) else {
            return InterfaceCompilerRecoveryProjectionReadOutcome::Denied {
                capability_id,
                denial: InterfaceCompilerCompiledReadDenial::Projection(
                    "recovery_projection_lifecycle_pointer_missing".to_string(),
                ),
            };
        };
        let replay = match self.read_replay(InterfaceCompilerReplayReadRequest {
            capability_id: capability_id.clone(),
            replay_id,
            credential: capability_request.credential,
            timeout: remaining,
        }) {
            InterfaceCompilerReplayReadOutcome::Found {
                projection,
                evidence,
            } => (projection, evidence),
            InterfaceCompilerReplayReadOutcome::NotFound { .. } => {
                return InterfaceCompilerRecoveryProjectionReadOutcome::NotFound { capability_id }
            }
            InterfaceCompilerReplayReadOutcome::Denied { denial, .. } => {
                return InterfaceCompilerRecoveryProjectionReadOutcome::Denied {
                    capability_id,
                    denial,
                }
            }
        };
        if !recovery_projection_pair_is_consistent(
            &capability.0,
            &capability.1,
            &replay.0,
            &replay.1,
        ) {
            return InterfaceCompilerRecoveryProjectionReadOutcome::Denied {
                capability_id,
                denial: InterfaceCompilerCompiledReadDenial::Projection(
                    "recovery_projection_pair_inconsistent".to_string(),
                ),
            };
        }
        InterfaceCompilerRecoveryProjectionReadOutcome::Found {
            capability: capability.0,
            capability_evidence: capability.1,
            replay: replay.0,
            replay_evidence: replay.1,
        }
    }

    pub fn read_capability(
        &self,
        request: InterfaceCompilerCompiledReadRequest,
    ) -> InterfaceCompilerCapabilityReadOutcome {
        if invalid(&request) {
            return InterfaceCompilerCapabilityReadOutcome::Denied {
                capability_id: request.capability_id,
                denial: InterfaceCompilerCompiledReadDenial::InvalidRequest,
            };
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
            Ok(value) => value,
            Err(denial) => {
                return InterfaceCompilerCapabilityReadOutcome::Denied {
                    capability_id: request.capability_id,
                    denial: InterfaceCompilerCompiledReadDenial::Authentication(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let principal = match self.application.resolve_authenticated_principal(
            &self.principal_binding,
            external,
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(value) => value,
            Err(denial) => {
                return InterfaceCompilerCapabilityReadOutcome::Denied {
                    capability_id: request.capability_id,
                    denial: InterfaceCompilerCompiledReadDenial::PrincipalResolution(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let identity = match self.application.resolve_entity(
            CapabilityIdentifier::reference(),
            request.capability_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(value) => value,
            Err(denial)
                if denial.kind()
                    == primary_graph::WorthQueryEntityResolutionDenialKind::UnknownEntity =>
            {
                return InterfaceCompilerCapabilityReadOutcome::NotFound {
                    capability_id: request.capability_id,
                }
            }
            Err(denial) => {
                return InterfaceCompilerCapabilityReadOutcome::Denied {
                    capability_id: request.capability_id,
                    denial: InterfaceCompilerCompiledReadDenial::EntityResolution(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let query = match self
            .application
            .installed_schema()
            .application_query(CapabilityReadQuery::reference())
        {
            Ok(value) => value,
            Err(_) => {
                return InterfaceCompilerCapabilityReadOutcome::Denied {
                    capability_id: request.capability_id,
                    denial: InterfaceCompilerCompiledReadDenial::QueryNotInstalled,
                }
            }
        };
        let access =
            primary_graph::WorthQueryApplicationQueryAccessContext::new(&principal, &identity);
        let parameters = declaration::application_query::ApplicationQueryParameterSet::new()
            .bind(capability_id_parameter(), request.capability_id.clone());
        let plan = match self.application.admit_application_query(
            &query,
            &access,
            parameters,
            primary_graph::WorthQueryApplicationQueryControls::current_one_shot(
                std::num::NonZeroUsize::new(QUERY_RESULT_LIMIT).unwrap(),
                std::num::NonZeroUsize::new(QUERY_RESULT_BYTES).unwrap(),
                &scope,
            ),
        ) {
            Ok(value) => value,
            Err(denial) => {
                return InterfaceCompilerCapabilityReadOutcome::Denied {
                    capability_id: request.capability_id,
                    denial: InterfaceCompilerCompiledReadDenial::QueryAdmission(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let result = match self.application.execute_application_query_one_shot(plan) {
            Ok(value) => value,
            Err(denial) => {
                return InterfaceCompilerCapabilityReadOutcome::Denied {
                    capability_id: request.capability_id,
                    denial: InterfaceCompilerCompiledReadDenial::QueryExecution(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let Some(projection) = result.rows().first().cloned() else {
            return InterfaceCompilerCapabilityReadOutcome::Denied {
                capability_id: request.capability_id,
                denial: InterfaceCompilerCompiledReadDenial::QueryExecution(
                    "cardinality_mismatch".to_string(),
                ),
            };
        };
        InterfaceCompilerCapabilityReadOutcome::Found {
            projection,
            evidence: receipt_evidence(CAPABILITY_READ_QUERY_NAME, &result),
        }
    }

    pub fn read_active_replay(
        &self,
        request: InterfaceCompilerCompiledReadRequest,
    ) -> InterfaceCompilerActiveReplayReadOutcome {
        if invalid(&request) {
            return InterfaceCompilerActiveReplayReadOutcome::Denied {
                capability_id: request.capability_id,
                denial: InterfaceCompilerCompiledReadDenial::InvalidRequest,
            };
        }
        let active_replay_id = match self.read_capability(request.clone()) {
            InterfaceCompilerCapabilityReadOutcome::Found { projection, .. }
                if projection.status == "healthy" && projection.active_replay_id.is_some() =>
            {
                projection
                    .active_replay_id
                    .expect("checked active replay identity")
            }
            InterfaceCompilerCapabilityReadOutcome::Found { .. } => {
                return InterfaceCompilerActiveReplayReadOutcome::Denied {
                    capability_id: request.capability_id,
                    denial: InterfaceCompilerCompiledReadDenial::Projection(
                        "capability_not_healthy".to_string(),
                    ),
                }
            }
            InterfaceCompilerCapabilityReadOutcome::NotFound { capability_id } => {
                return InterfaceCompilerActiveReplayReadOutcome::NotFound { capability_id }
            }
            InterfaceCompilerCapabilityReadOutcome::Denied {
                capability_id,
                denial,
            } => {
                return InterfaceCompilerActiveReplayReadOutcome::Denied {
                    capability_id,
                    denial,
                }
            }
        };
        match self.read_replay(InterfaceCompilerReplayReadRequest {
            capability_id: request.capability_id.clone(),
            replay_id: active_replay_id,
            credential: request.credential,
            timeout: request.timeout,
        }) {
            InterfaceCompilerReplayReadOutcome::Found {
                projection,
                evidence,
            } if projection.status == "active"
                && projection.capability_id == request.capability_id
                && projection.verified_at.is_some() =>
            {
                InterfaceCompilerActiveReplayReadOutcome::Found {
                    projection,
                    evidence,
                }
            }
            InterfaceCompilerReplayReadOutcome::Found { .. } => {
                InterfaceCompilerActiveReplayReadOutcome::Denied {
                    capability_id: request.capability_id,
                    denial: InterfaceCompilerCompiledReadDenial::Projection(
                        "active_replay_projection_invalid".to_string(),
                    ),
                }
            }
            InterfaceCompilerReplayReadOutcome::NotFound { .. } => {
                InterfaceCompilerActiveReplayReadOutcome::NotFound {
                    capability_id: request.capability_id,
                }
            }
            InterfaceCompilerReplayReadOutcome::Denied { denial, .. } => {
                InterfaceCompilerActiveReplayReadOutcome::Denied {
                    capability_id: request.capability_id,
                    denial,
                }
            }
        }
    }

    pub fn read_replay(
        &self,
        request: InterfaceCompilerReplayReadRequest,
    ) -> InterfaceCompilerReplayReadOutcome {
        if request.capability_id.trim().is_empty()
            || request.replay_id.trim().is_empty()
            || request.credential.trim().is_empty()
            || request.timeout.is_zero()
            || request.timeout > MAX_REQUEST_TIMEOUT
        {
            return InterfaceCompilerReplayReadOutcome::Denied {
                replay_id: request.replay_id,
                denial: InterfaceCompilerCompiledReadDenial::InvalidRequest,
            };
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
            Ok(value) => value,
            Err(denial) => {
                return InterfaceCompilerReplayReadOutcome::Denied {
                    replay_id: request.replay_id,
                    denial: InterfaceCompilerCompiledReadDenial::Authentication(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let principal = match self.application.resolve_authenticated_principal(
            &self.principal_binding,
            external,
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(value) => value,
            Err(denial) => {
                return InterfaceCompilerReplayReadOutcome::Denied {
                    replay_id: request.replay_id,
                    denial: InterfaceCompilerCompiledReadDenial::PrincipalResolution(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let identity = match self.application.resolve_entity(
            ReplayIdentifier::reference(),
            request.replay_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(value) => value,
            Err(denial)
                if denial.kind()
                    == primary_graph::WorthQueryEntityResolutionDenialKind::UnknownEntity =>
            {
                return InterfaceCompilerReplayReadOutcome::NotFound {
                    replay_id: request.replay_id,
                }
            }
            Err(denial) => {
                return InterfaceCompilerReplayReadOutcome::Denied {
                    replay_id: request.replay_id,
                    denial: InterfaceCompilerCompiledReadDenial::EntityResolution(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let query = match self
            .application
            .installed_schema()
            .application_query(ActiveReplayReadQuery::reference())
        {
            Ok(value) => value,
            Err(_) => {
                return InterfaceCompilerReplayReadOutcome::Denied {
                    replay_id: request.replay_id,
                    denial: InterfaceCompilerCompiledReadDenial::QueryNotInstalled,
                }
            }
        };
        let access =
            primary_graph::WorthQueryApplicationQueryAccessContext::new(&principal, &identity);
        let parameters = declaration::application_query::ApplicationQueryParameterSet::new()
            .bind(replay_id_parameter(), request.replay_id.clone());
        let plan = match self.application.admit_application_query(
            &query,
            &access,
            parameters,
            primary_graph::WorthQueryApplicationQueryControls::current_one_shot(
                std::num::NonZeroUsize::new(QUERY_RESULT_LIMIT).unwrap(),
                std::num::NonZeroUsize::new(QUERY_RESULT_BYTES).unwrap(),
                &scope,
            ),
        ) {
            Ok(value) => value,
            Err(denial) => {
                return InterfaceCompilerReplayReadOutcome::Denied {
                    replay_id: request.replay_id,
                    denial: InterfaceCompilerCompiledReadDenial::QueryAdmission(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let result = match self.application.execute_application_query_one_shot(plan) {
            Ok(value) => value,
            Err(denial) => {
                return InterfaceCompilerReplayReadOutcome::Denied {
                    replay_id: request.replay_id,
                    denial: InterfaceCompilerCompiledReadDenial::QueryExecution(format!(
                        "{:?}",
                        denial.kind()
                    )),
                }
            }
        };
        let Some(projection) = result.rows().first().cloned() else {
            return InterfaceCompilerReplayReadOutcome::Denied {
                replay_id: request.replay_id,
                denial: InterfaceCompilerCompiledReadDenial::QueryExecution(
                    "cardinality_mismatch".to_string(),
                ),
            };
        };
        if projection.capability_id != request.capability_id {
            return InterfaceCompilerReplayReadOutcome::Denied {
                replay_id: request.replay_id,
                denial: InterfaceCompilerCompiledReadDenial::Projection(
                    "replay_capability_mismatch".to_string(),
                ),
            };
        }
        InterfaceCompilerReplayReadOutcome::Found {
            projection,
            evidence: receipt_evidence(ACTIVE_REPLAY_READ_QUERY_NAME, &result),
        }
    }
}

pub(super) fn recovery_projection_pair_is_consistent(
    capability: &InterfaceCompilerCapabilityProjection,
    capability_evidence: &InterfaceCompilerApplicationReadEvidence,
    replay: &InterfaceCompilerActiveReplayProjection,
    replay_evidence: &InterfaceCompilerApplicationReadEvidence,
) -> bool {
    replay.capability_id == capability.id
        && recovery_replay_id(capability) == Some(replay.id.as_str())
        && match capability.status.as_str() {
            "degraded" => replay.status == "broken",
            "verifying" => replay.status == "verifying",
            "healthy" => replay.status == "active",
            _ => false,
        }
        && capability_evidence.basis_version == replay_evidence.basis_version
}

fn recovery_replay_id(capability: &InterfaceCompilerCapabilityProjection) -> Option<&str> {
    match capability.status.as_str() {
        "degraded" => capability.broken_replay_id.as_deref(),
        "verifying" => capability.candidate_replay_id.as_deref(),
        "healthy" => capability.active_replay_id.as_deref(),
        _ => None,
    }
}

fn invalid(request: &InterfaceCompilerCompiledReadRequest) -> bool {
    request.capability_id.trim().is_empty()
        || request.credential.trim().is_empty()
        || request.timeout.is_zero()
        || request.timeout > MAX_REQUEST_TIMEOUT
}

fn receipt_evidence<S, Q>(
    name: &str,
    result: &primary_graph::WorthQueryApplicationOneShotResult<S, Q>,
) -> InterfaceCompilerApplicationReadEvidence {
    let receipt = result.receipt();
    InterfaceCompilerApplicationReadEvidence {
        query_name: name.to_string(),
        query_identity: receipt.query_identity().render_support_hex(),
        basis_version: receipt.basis_version().as_u64(),
        projected_record_count: receipt.projected_record_count(),
        projected_field_count: receipt.projected_field_count(),
        basis_released: receipt.basis_released(),
    }
}
