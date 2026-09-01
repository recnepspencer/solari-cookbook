import type { CompiledPlanReadPort, ReplayRecoveryPort, WorthApplicationReadAdapter, WorthExecutionRuntimePort } from "@interface-compiler/worth-adapter"
import type { WorthAuthority } from "@interface-compiler/domain"

export interface OrchestratorWorthPort extends WorthApplicationReadAdapter, CompiledPlanReadPort, WorthExecutionRuntimePort, ReplayRecoveryPort {
  readonly readEvidence?: WorthAuthority["readEvidence"]
}
