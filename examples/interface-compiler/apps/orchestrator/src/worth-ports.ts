import type { WorthAdapter } from "@interface-compiler/worth-adapter"
export type OrchestratorWorthPort = Pick<WorthAdapter, "readApplication" | "readCapability" | "readActiveReplay" | "readEvidence" | "startExecution" | "completeExecution" | "recordReplayFailure" | "resumeCapabilityExploration" | "publish">
