use worth_query_host::facade::primary_graph;

use super::{
    denied, valid_context, valid_identity, validation::valid_candidate_request,
    AcceptReplacementCandidateRequest, InterfaceCompilerReplayRecoveryOutcome,
    InterfaceCompilerReplayRecoveryStage,
};
use crate::application::{
    AcceptReplacementCandidate, AcceptReplacementCandidateInput, Capability, CapabilityIdentifier,
    InterfaceCompilerSchema, ReplayIdentifier,
};
use crate::host::InterfaceCompilerWorthHost;

mod decision;
mod mutation;

pub(super) type Admission = primary_graph::WorthQueryAdmittedApplicationOperation<
    InterfaceCompilerSchema,
    AcceptReplacementCandidate,
    AcceptReplacementCandidateInput,
    Capability,
>;

impl InterfaceCompilerWorthHost {
    pub fn accept_replacement_candidate(
        &self,
        request: AcceptReplacementCandidateRequest,
    ) -> InterfaceCompilerReplayRecoveryOutcome {
        if !valid_context(&request.credential, request.timeout)
            || !valid_identity(&request.capability_id, "capability.")
            || !valid_identity(&request.broken_replay_version_id, "replay.")
            || !valid_candidate_request(&request)
        {
            return denied(
                InterfaceCompilerReplayRecoveryStage::Request,
                "the replacement candidate request is malformed",
            );
        }
        let scope = super::super::settlement_support::scope(request.timeout);
        let principal = match self.authenticate_execution_principal(&request.credential, &scope) {
            Ok(value) => value,
            Err(outcome) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::Authentication,
                    format!("WORTH principal admission denied the candidate: {outcome:?}"),
                )
            }
        };
        let capability = match self.application.resolve_entity(
            CapabilityIdentifier::reference(),
            request.capability_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::EntityResolution,
                    format!("capability resolution denied: {error:?}"),
                )
            }
        };
        let _broken_replay = match self.application.resolve_entity(
            ReplayIdentifier::reference(),
            request.broken_replay_version_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::EntityResolution,
                    format!("broken replay resolution denied: {error:?}"),
                )
            }
        };
        match self.application.resolve_entity(
            ReplayIdentifier::reference(),
            request.candidate.replay_version_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(_) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                    "the replacement replay identity already exists",
                )
            }
            Err(error)
                if error.kind()
                    == primary_graph::WorthQueryEntityResolutionDenialKind::UnknownEntity => {}
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::EntityResolution,
                    format!("candidate identity resolution denied: {error:?}"),
                )
            }
        }
        let operation = match self
            .application
            .installed_schema()
            .installed_operation(AcceptReplacementCandidate::reference())
        {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                    format!("candidate operation unavailable: {error:?}"),
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
                    InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                    format!("WORTH denied candidate admission: {error:?}"),
                )
            }
        };

        let admitted = match decision::admit_candidate(self, &request, &admission) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        mutation::commit_candidate(self, &request, &capability, admission, admitted)
    }
}
