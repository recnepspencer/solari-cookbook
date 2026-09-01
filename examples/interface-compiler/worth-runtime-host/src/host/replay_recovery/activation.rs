use worth_query_host::facade::primary_graph;

use super::{
    denied, valid_context, valid_identity, valid_timestamp,
    verification_contract::valid_verification_request_revisions, ActivateReplacementRequest,
    InterfaceCompilerReplayRecoveryOutcome, InterfaceCompilerReplayRecoveryStage,
};
use crate::application::{
    ActivateReplacement, ActivateReplacementInput, Capability, CapabilityIdentifier,
    InterfaceCompilerSchema, ReplayIdentifier,
};
use crate::host::InterfaceCompilerWorthHost;

mod decision;
mod mutation;

pub(super) type Admission = primary_graph::WorthQueryAdmittedApplicationOperation<
    InterfaceCompilerSchema,
    ActivateReplacement,
    ActivateReplacementInput,
    Capability,
>;

impl InterfaceCompilerWorthHost {
    pub fn activate_replacement(
        &self,
        request: ActivateReplacementRequest,
    ) -> InterfaceCompilerReplayRecoveryOutcome {
        if !valid_context(&request.credential, request.timeout)
            || !valid_identity(&request.capability_id, "capability.")
            || !valid_identity(&request.replay_version_id, "replay.")
            || !valid_timestamp(&request.verified_at)
            || !valid_verification_request_revisions(
                request.expected_capability_revision,
                request.expected_replay_revision,
            )
        {
            return denied(
                InterfaceCompilerReplayRecoveryStage::Request,
                "the replacement activation request is malformed",
            );
        }
        let scope = super::super::settlement_support::scope(request.timeout);
        let principal = match self.authenticate_execution_principal(&request.credential, &scope) {
            Ok(value) => value,
            Err(outcome) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::Authentication,
                    format!("WORTH principal admission denied activation: {outcome:?}"),
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
        let replay = match self.application.resolve_entity(
            ReplayIdentifier::reference(),
            request.replay_version_id.clone(),
            &scope,
            primary_graph::WorthQueryPrincipalResolutionMode::Ordinary,
        ) {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::EntityResolution,
                    format!("candidate replay resolution denied: {error:?}"),
                )
            }
        };
        let operation = match self
            .application
            .installed_schema()
            .installed_operation(ActivateReplacement::reference())
        {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                    format!("activation operation unavailable: {error:?}"),
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
                    format!("WORTH denied replacement activation: {error:?}"),
                )
            }
        };
        let admitted = match decision::admit_activation(self, &request, &admission) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        mutation::commit_activation(self, &request, &capability, &replay, admission, admitted)
    }
}
