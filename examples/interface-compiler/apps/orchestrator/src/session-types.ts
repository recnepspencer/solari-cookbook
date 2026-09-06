import type {
  Condition,
  InterfaceCompilerEventMap,
  InterfaceCompilerEventType,
  JsonValue,
  PartialEffectPosture,
  ReplayFailure,
  ReplayStep,
  SafetyStopResult,
} from "@interface-compiler/domain"
import type { ExecutionFailureClassification } from "./failure-diagnosis.js"
import type { RuntimeStop } from "./operation.js"

export type ExperimentTerminal =
  | { readonly kind: "success"; readonly output?: JsonValue; readonly successfulSteps?: readonly ReplayStep[] }
  | { readonly kind: "failure"; readonly message: string; readonly retryable?: boolean; readonly replayFailure?: ReplayFailure; readonly failedCondition?: Condition; readonly posture?: PartialEffectPosture; readonly classification?: ExecutionFailureClassification }
  | { readonly kind: "safety_stop"; readonly stop: SafetyStopResult }
  | { readonly kind: "control_stop"; readonly stop: RuntimeStop }

export type RuntimeEventPublication =
  | { readonly kind: "published" }
  | { readonly kind: "stopped"; readonly stop: RuntimeStop }
  | { readonly kind: "failed"; readonly message: string; readonly posture: PartialEffectPosture }

export type RuntimeEventEmitter = <T extends InterfaceCompilerEventType>(
  type: T,
  payload: InterfaceCompilerEventMap[T],
  idempotencyKey: string,
) => Promise<RuntimeEventPublication>
