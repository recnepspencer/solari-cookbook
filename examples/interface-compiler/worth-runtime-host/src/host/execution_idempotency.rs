//! Deterministic WORTH commit identity for execution lifecycle operations.

use sha2::{Digest, Sha256};
use worth_query_host::facade::primary_graph;

const START_EXECUTION_OPERATION_IDENTITY: &[u8] = b"interface-compiler.worth.start-execution.v1";

pub(super) fn start_execution_idempotency_binding(
    canonical_execution_id: &str,
) -> primary_graph::WorthQueryApplicationIdempotencyBinding {
    primary_graph::WorthQueryApplicationIdempotencyBinding::new(
        identity_digest(b"key", canonical_execution_id),
        identity_digest(b"intent", canonical_execution_id),
    )
}

fn identity_digest(slot: &[u8], canonical_execution_id: &str) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(START_EXECUTION_OPERATION_IDENTITY);
    digest.update([0]);
    digest.update(slot);
    digest.update([0]);
    digest.update(canonical_execution_id.as_bytes());
    digest.finalize().into()
}
