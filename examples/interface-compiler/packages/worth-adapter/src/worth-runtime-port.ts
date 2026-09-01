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

/**
 * Binding descriptor for an integration backed by the public
 * `worth-query-host::facade` boundary.
 *
 * The wrapper keeps transport and FFI details out of the adapter while making
 * an absent Node binding fail closed. `boundary` is routing metadata, not an
 * attestation token: the adapter validates the port shape but cannot prove
 * that an arbitrary JavaScript object is backed by WORTH. Production code must
 * obtain this descriptor from an actual host integration. This package does
 * not define an HTTP, RPC, or process protocol.
 */
export const WORTH_QUERY_HOST_FACADE_BOUNDARY = "worth-query-host::facade" as const

export interface WorthQueryHostFacadeBinding {
  readonly boundary: typeof WORTH_QUERY_HOST_FACADE_BOUNDARY
  readonly runtime: WorthRuntimePort
}

/** The adapter's event surface is intentionally the domain publisher contract. */
export type WorthEventPort = Pick<EventPublisher, "publish">
