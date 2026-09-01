use worth_query_host::facade::primary_graph;

use super::{
    denied, valid_context, valid_identity,
    validation::{valid_verification_request_revisions, valid_verification_run},
    InterfaceCompilerReplayRecoveryOutcome, InterfaceCompilerReplayRecoveryStage,
    RecordReplacementVerificationRequest,
};
use crate::application::{
    InterfaceCompilerSchema, RecordReplacementVerification, RecordReplacementVerificationInput,
    Replay, ReplayIdentifier,
};
use crate::host::InterfaceCompilerWorthHost;

mod decision;
mod mutation;

pub(super) type Admission = primary_graph::WorthQueryAdmittedApplicationOperation<
    InterfaceCompilerSchema,
    RecordReplacementVerification,
    RecordReplacementVerificationInput,
    Replay,
>;

impl InterfaceCompilerWorthHost {
    pub fn record_replacement_verification(
        &self,
        request: RecordReplacementVerificationRequest,
    ) -> InterfaceCompilerReplayRecoveryOutcome {
        if !valid_context(&request.credential, request.timeout)
            || !valid_identity(&request.capability_id, "capability.")
            || !valid_identity(&request.replay_version_id, "replay.")
            || !valid_verification_request_revisions(
                request.expected_capability_revision,
                request.expected_replay_revision,
            )
            || !valid_verification_run(&request.run)
        {
            return denied(
                InterfaceCompilerReplayRecoveryStage::Request,
                "the replacement verification request is malformed",
            );
        }
        let scope = super::super::settlement_support::scope(request.timeout);
        let principal = match self.authenticate_execution_principal(&request.credential, &scope) {
            Ok(value) => value,
            Err(outcome) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::Authentication,
                    format!("WORTH principal admission denied verification: {outcome:?}"),
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
            .installed_operation(RecordReplacementVerification::reference())
        {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                    format!("verification operation unavailable: {error:?}"),
                )
            }
        };
        let admission: Admission = match self.application.authorize_operation(
            &principal,
            &replay,
            &operation,
            Default::default(),
            &scope,
        ) {
            Ok(value) => value,
            Err(error) => {
                return denied(
                    InterfaceCompilerReplayRecoveryStage::OperationAdmission,
                    format!("WORTH denied verification admission: {error:?}"),
                )
            }
        };
        let admitted = match decision::admit_verification(self, &request, &admission) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
        mutation::commit_verification(self, &request, &replay, admission, admitted)
    }
}
