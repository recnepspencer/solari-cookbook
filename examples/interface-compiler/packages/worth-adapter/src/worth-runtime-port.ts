import type {
  CapabilityId,
  CompilationMetrics,
  EventPublicationResult,
  EventPublisher,
  InterfaceCompilerEvent,
  LifetimeEconomics,
  OperationContext,
  WorthReadResult,
  WorthAuthority,
} from "@interface-compiler/domain"

/** A Worth-owned projection of measured compilation and execution economics. */
export interface WorthCompilationMetricsProjection {
  readonly projectionKind: "worth_compilation_metrics"
  readonly capabilityId: CapabilityId
  readonly revision: number
  readonly compilation: CompilationMetrics
  readonly lifetime?: LifetimeEconomics
}

export interface WorthMetricsQueries {
  readCompilationMetrics(capabilityId: CapabilityId, context: OperationContext): Promise<WorthReadResult<WorthCompilationMetricsProjection>>
}

/**
 * The process or transport boundary supplied by the real Worth runtime.
 *
 * Worth Query owns durable lifecycle, execution, lineage, evidence, events,
 * and projections. This port deliberately returns the shared domain contract
 * instead of exposing a store handle, mutable aggregate, or transport-shaped
 * copy that this package could accidentally treat as authority.
 *
 * A production implementation should enter Worth through its public host
 * facade (`worth-query-host::facade`) and translate that runtime's typed
 * outcomes at this boundary. This package does not provide an in-memory
 * implementation or choose a transport that the cookbook has not specified.
 */
export interface WorthRuntimePort extends WorthAuthority, WorthMetricsQueries {
  publishEvent(event: InterfaceCompilerEvent, context: OperationContext): Promise<EventPublicationResult>
}

/** The adapter's event surface is intentionally the domain publisher contract. */
export type WorthEventPort = Pick<EventPublisher, "publish">
