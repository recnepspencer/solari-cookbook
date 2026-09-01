import type { OperationContext, SolariCloseResult, SolariSessionLease } from "@interface-compiler/domain"

/** Releases the adapter-owned lease exactly once through the admitted context.
 * A cancelled context is intentionally not replaced with locally minted
 * authority; an unsuccessful release remains an explicit reconciliation result.
 */
export async function closeSolariSession(lease: SolariSessionLease, context: OperationContext): Promise<SolariCloseResult> {
  try {
    return await lease.release(context)
  } catch {
    return {
      kind: "close_failed",
      message: "Solari session cleanup failed",
      retryable: true,
      effect: { kind: "unknown", recovery: "owner_reconciliation_required" },
    }
  }
}
