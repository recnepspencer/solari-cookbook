use worth_query_host::facade::primary_graph;

use super::{
    denied, valid_context, valid_identity, valid_wire_revision, DegradeReplayRequest,
    InterfaceCompilerReplayRecoveryOutcome, InterfaceCompilerReplayRecoveryStage,
};
use crate::application::{
    Capability, CapabilityIdentifier, DegradeReplay, DegradeReplayInput, InterfaceCompilerSchema,
    ReplayIdentifier,
};
use crate::host::InterfaceCompilerWorthHost;

mod decision;
mod mutation;

pub(super) type Admission = primary_graph::WorthQueryAdmittedApplicationOperation<
    InterfaceCompilerSchema,
    DegradeReplay,
    DegradeReplayInput,
    Capability,
>;

impl InterfaceCompilerWorthHost {
    pub fn degrade_replay(
        &self,
        request: DegradeReplayRequest,
    ) -> InterfaceCompilerReplayRecoveryOutcome {
        if !valid_context(&request.credential, request.timeout)
            || !valid_identity(&request.execution_id, "execution.")
            || !valid_identity(&request.capability_id, "capability.")
            || !valid_identity(&request.replay_version_id, "replay.")
            || !valid_wire_revision(request.expected_execution_revision)
            || !valid_wire_revision(request.expected_capability_revision)
            || !valid_wire_revision(request.expected_replay_revision)
        {
            return denied(
                InterfaceCompilerReplayRecoveryStage::Request,
                "the replay degradation request is malformed",
            );
        }
        let scope = super::super::settlement_support::scope(request.timeout);
        let principal = match self.authenticate_execution_principal(&request.credential, &scope) {
            Ok(value) => value,
            Err(outcome) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::Authentication,
                    format!("WORTH principal admission denied recovery: {outcome:?}"),
                )
            }
        };
        let _execution = match self.resolve_execution(&request.execution_id, &scope) {
            Ok(value) => value,
            Err(outcome) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::EntityResolution,
                    format!("WORTH could not resolve the failed execution: {outcome:?}"),
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
                    format!("WORTH could not resolve the capability: {error:?}"),
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
                    format!("WORTH could not resolve the active replay: {error:?}"),
                )
            }
        };
        let operation = match self
            .application
            .installed_schema()
            .installed_operation(DegradeReplay::reference())
        {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                    format!("the WORTH degradation operation is unavailable: {error:?}"),
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
                    format!("WORTH denied replay degradation: {error:?}"),
                )
            }
        };

        let admitted = match decision::admit_degradation(self, &request, &admission) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        mutation::commit_degradation(self, &request, &capability, &replay, admission, admitted)
    }
}
