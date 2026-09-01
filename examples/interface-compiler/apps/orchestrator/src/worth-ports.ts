import type { CompiledPlanReadPort, WorthApplicationReadAdapter, WorthExecutionRuntimePort } from "@interface-compiler/worth-adapter"
import type { WorthAuthority } from "@interface-compiler/domain"

export interface OrchestratorWorthPort extends WorthApplicationReadAdapter, CompiledPlanReadPort, WorthExecutionRuntimePort {
  readonly readEvidence?: WorthAuthority["readEvidence"]
}
