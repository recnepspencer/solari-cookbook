import type { CompiledPlanReadPort, ReplayRecoveryPort, WorthApplicationReadAdapter, WorthExecutionRuntimePort } from "@interface-compiler/worth-adapter"

export interface OrchestratorWorthPort extends WorthApplicationReadAdapter, CompiledPlanReadPort, WorthExecutionRuntimePort, ReplayRecoveryPort {}
