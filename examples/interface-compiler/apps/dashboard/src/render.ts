import type {
  BreakEvenCalls,
  CapabilityProjection,
  DiscoveryReason,
  ExecutionProjection,
  ReplayFailure,
} from "@interface-compiler/domain"
import type {
  BenchmarkMetric,
  BenchmarkSideProjection,
  CapabilityEconomicsProjection,
  DashboardCapabilityProjection,
  DashboardReplayProjection,
  DashboardMode,
  WorthDashboardResult,
} from "./dashboard-contract.js"
import { createDashboardView, resolveCapabilityReplay, type DashboardViewModel, type EvidenceView, type VerificationPosture } from "./view-model.js"

export function renderDashboardResult(result: WorthDashboardResult, selectedCapabilityId?: string): string {
  switch (result.kind) {
    case "ready":
      return renderDashboard(createDashboardView(result.projection, selectedCapabilityId))
    case "cancelled":
      return renderState("Query cancelled", result.message ?? "The Worth projection query was cancelled before completion.", "cancelled")
    case "timed_out":
      return renderState("Worth query timed out", result.message ?? "No projection was returned before the query deadline.", "timed-out")
    case "stale":
      return renderState("Stale Worth projection", result.message ?? `Revision ${result.sourceRevision} is older than the current revision ${result.currentRevision}.`, "retryable")
    case "unavailable":
      return renderState("WORTH QUERY NOT CONNECTED", result.message ?? unavailableMessage(result.reason), "unavailable", result.reason !== "not_configured")
    case "failed":
      return renderState("Worth projection failed", result.message, result.retryable ? "retryable" : "failed")
  }
}

export function renderLoadingState(): string {
  return `
    <main class="state-shell state-loading" aria-live="polite">
      <div class="state-card">
        <span class="source-pill">WORTH QUERY</span>
        <h1>Loading projection</h1>
        <p>Requesting the latest read-only projection from Worth…</p>
      </div>
    </main>
  `
}

export function renderDashboard(view: DashboardViewModel): string {
  const application = view.projection.application
  const applicationName = application?.name ?? "Application projection unavailable"
  const baseUrl = application?.baseUrl ?? "No application URL returned"

  return `
    <main class="dashboard-shell" aria-labelledby="dashboard-title">
      <header class="topbar">
        <div>
          <p class="eyebrow">Interface Compiler · Operator View</p>
          <h1 id="dashboard-title">${escapeHtml(applicationName)}</h1>
          <p class="subtle">${escapeHtml(baseUrl)}</p>
        </div>
        <div class="topbar-meta">
          <span class="source-pill"><span class="status-dot status-dot-ok"></span>WORTH PROJECTION</span>
          <span class="subtle">Revision ${escapeHtml(String(view.projection.sourceRevision))}</span>
          <span class="subtle">Updated ${escapeHtml(formatTimestamp(view.projection.generatedAt))}</span>
        </div>
      </header>

      <section class="connection-strip" aria-label="Projection connection">
        <div>
          <strong>Read-only source</strong>
          <span class="subtle">Every record below is supplied by Worth. This page has no command or verification path.</span>
        </div>
        <button class="button button-secondary" type="button" data-action="refresh">Refresh projection</button>
      </section>

      <section class="mode-banner" aria-label="Current operating mode">
        <div>
          <p class="eyebrow">Operating mode</p>
          <div class="mode-line"><span class="mode-value">${escapeHtml(view.projection.mode.value.toUpperCase())}</span><span class="mode-source">Worth revision ${escapeHtml(String(view.projection.mode.sourceRevision))}</span></div>
        </div>
        <p>${escapeHtml(modeExplanation(view.projection.mode.value))}</p>
      </section>

      <section class="kpi-grid" aria-label="Overview metrics">
        ${renderKpi("Capabilities", String(view.projection.capabilities.length), "Worth capability projections")}
        ${renderKpi("Active sessions", String(view.activeSessionCount), "Solari sessions in projection")}
        ${renderKpi("Projected runs", String(view.recentExecutions.length), "Execution projections returned by Worth")}
      </section>

      <div class="dashboard-grid dashboard-grid-main">
        <section class="panel capability-panel" aria-labelledby="capabilities-heading">
          <div class="panel-heading">
            <div><p class="eyebrow">Authority view</p><h2 id="capabilities-heading">Capabilities</h2></div>
            <span class="count-badge">${escapeHtml(String(view.projection.capabilities.length))}</span>
          </div>
          ${renderCapabilityList(view)}
        </section>

        <section class="panel detail-panel" aria-labelledby="detail-heading">
          <div class="panel-heading">
            <div><p class="eyebrow">Selected capability</p><h2 id="detail-heading">${escapeHtml(view.selectedCapability?.capability.name ?? "No capability selected")}</h2></div>
            ${view.selectedCapability === null ? "" : renderCapabilityStatus(view.selectedCapability.capability)}
          </div>
          ${renderCapabilityDetail(view)}
        </section>
      </div>

      <div class="dashboard-grid dashboard-grid-two">
        <section class="panel" aria-labelledby="executions-heading">
          <div class="panel-heading"><div><p class="eyebrow">Measured activity</p><h2 id="executions-heading">Runs</h2></div><span class="subtle">${escapeHtml(String(view.selectedExecutions.length))} for selected capability</span></div>
          ${renderExecutions(view)}
        </section>

        <section class="panel" aria-labelledby="evidence-heading">
          <div class="panel-heading"><div><p class="eyebrow">Verification material</p><h2 id="evidence-heading">Evidence</h2></div><span class="subtle">Worth records only</span></div>
          ${renderEvidence(view.selectedEvidence)}
        </section>
      </div>

      <div class="dashboard-grid dashboard-grid-two">
        <section class="panel" aria-labelledby="economics-heading">
          <div class="panel-heading"><div><p class="eyebrow">Cost model</p><h2 id="economics-heading">Economics</h2></div></div>
          ${renderEconomics(view.selectedEconomics)}
        </section>

        <section class="panel" aria-labelledby="benchmark-heading">
          <div class="panel-heading"><div><p class="eyebrow">Comparison</p><h2 id="benchmark-heading">Benchmark</h2></div><span class="subtle">Measured execution projections</span></div>
          ${renderBenchmark(view)}
        </section>
      </div>

      <div class="dashboard-grid dashboard-grid-two">
        <section class="panel" aria-labelledby="lineage-heading">
          <div class="panel-heading"><div><p class="eyebrow">Version history</p><h2 id="lineage-heading">Replay lineage</h2></div></div>
          ${renderLineage(view)}
        </section>

        <section class="panel" aria-labelledby="sessions-heading">
          <div class="panel-heading"><div><p class="eyebrow">Solari activity</p><h2 id="sessions-heading">Sessions</h2></div><span class="subtle">${escapeHtml(String(view.projection.sessions.length))} projected</span></div>
          ${renderSessions(view)}
        </section>
      </div>

      <footer class="dashboard-footer">Gemini proposes · Solari executes · Worth remembers what is trusted</footer>
    </main>
  `
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return character
    }
  })
}

function renderState(title: string, message: string, kind: "cancelled" | "timed-out" | "unavailable" | "retryable" | "failed", showRetry = kind === "retryable" || kind === "timed-out" || kind === "cancelled"): string {
  const action = showRetry ? `<p class="state-hint">The projection can be requested again.</p><button class="button button-secondary" type="button" data-action="refresh">Retry projection</button>` : ""
  return `
    <main class="state-shell state-${kind}" aria-live="polite">
      <div class="state-card">
        <span class="source-pill">WORTH QUERY</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        ${action}
        <p class="state-footnote">This dashboard does not create, infer, or repair authority records.</p>
      </div>
    </main>
  `
}

function renderKpi(label: string, value: string, note: string): string {
  return `<article class="kpi-card"><span class="kpi-label">${escapeHtml(label)}</span><strong class="kpi-value">${escapeHtml(value)}</strong><span class="kpi-note">${escapeHtml(note)}</span></article>`
}

function renderCapabilityList(view: DashboardViewModel): string {
  if (view.projection.capabilities.length === 0) return `<p class="empty-state">No capability projections were returned by Worth.</p>`
  return `<div class="capability-list">${view.projection.capabilities.map((item) => {
    const capability = item.capability
    const isSelected = String(capability.id) === String(view.selectedCapabilityId)
    const replay = replayForCapability(view, capability.id)
    return `
      <button class="capability-row${isSelected ? " capability-row-selected" : ""}" type="button" data-capability-id="${escapeHtml(String(capability.id))}" aria-pressed="${isSelected ? "true" : "false"}">
        <span class="capability-row-main"><strong>${escapeHtml(capability.name)}</strong><span>${escapeHtml(capability.description)}</span></span>
        <span class="capability-row-meta"><span class="status-badge status-${escapeHtml(capability.status)}">${escapeHtml(capability.status.toUpperCase())}</span><span class="version-label">${replay === null ? missingLifecyclePointer(item, view) : `v${escapeHtml(String(replay.version))}`}</span></span>
      </button>
    `
  }).join("")}</div>`
}

function renderCapabilityDetail(view: DashboardViewModel): string {
  if (view.selectedCapability === null) return `<p class="empty-state">Select a capability projection to inspect its replay, evidence, and measured economics.</p>`
  const capability = view.selectedCapability.capability
  const replay = view.selectedReplay
  const failure = capability.status === "degraded" ? capability.failure.message : null
  const discovery = capability.status === "discovering" ? renderDiscoveryContext(capability.discovery) : ""
  const replayWarning = view.selectedReplayResolution === "missing_pointer"
    ? `<div class="alert alert-warning"><strong>Replay projection missing:</strong> Worth points this capability at a replay version that was not returned. No historical version was substituted.</div>`
    : view.selectedReplayResolution === "inconsistent_pointer"
      ? `<div class="alert alert-danger"><strong>Lifecycle pointer inconsistent:</strong> Worth points this capability at a replay with an incompatible lifecycle status. No replay was presented as trusted.</div>`
      : ""
  return `
    <div class="detail-intro">
      <p>${escapeHtml(capability.description)}</p>
      ${failure === null ? "" : `<div class="alert alert-danger"><strong>Degraded:</strong> ${escapeHtml(failure)}</div>`}
      ${discovery}
      ${replayWarning}
    </div>
    <div class="detail-grid">
      <div class="detail-card"><span class="detail-label">Replay</span><strong>${replay === null ? capability.status === "discovering" ? "Discovery in progress" : "Not returned" : `v${escapeHtml(String(replay.version))}`}</strong><span class="subtle">${replay === null ? capability.status === "discovering" ? "Worth has not returned a replay for this discovery context." : "No replay projection" : escapeHtml(replayStatusDescription(replay))}</span></div>
      <div class="detail-card"><span class="detail-label">Confidence</span><strong>${replay === null ? "Not available" : formatPercent(replay.confidence)}</strong><span class="subtle">Reported by Worth</span></div>
      <div class="detail-card"><span class="detail-label">Verification</span><strong>${verificationHeadline(view.selectedVerification)}</strong><span class="subtle">${escapeHtml(view.selectedVerification.explanation)}</span></div>
    </div>
    ${renderContract(view.selectedCapability)}
    <div class="subsection"><div class="subsection-heading"><h3>Verification status</h3>${renderVerificationBadge(view.selectedVerification.posture)}</div>${renderVerification(view)}</div>
  `
}

function renderContract(capability: { readonly contract?: { readonly inputSchema: unknown; readonly outputSchema: unknown; readonly preconditions: readonly unknown[]; readonly postconditions: readonly unknown[] } }): string {
  if (capability.contract === undefined) {
    return `<div class="subsection"><div class="subsection-heading"><h3>Semantic contract</h3><span class="status-badge status-neutral">NOT IN PROJECTION</span></div><p class="empty-state">Worth did not include the input/output contract in this dashboard projection.</p></div>`
  }
  return `
    <div class="subsection"><div class="subsection-heading"><h3>Semantic contract</h3><span class="status-badge status-neutral">PROJECTION DATA</span></div>
      <div class="contract-grid">
        <div><span class="detail-label">Input schema</span><pre class="code-block">${escapeHtml(formatJson(capability.contract.inputSchema))}</pre></div>
        <div><span class="detail-label">Output schema</span><pre class="code-block">${escapeHtml(formatJson(capability.contract.outputSchema))}</pre></div>
      </div>
      <div class="condition-grid"><div><span class="detail-label">Preconditions</span>${renderJsonList(capability.contract.preconditions)}</div><div><span class="detail-label">Postconditions</span>${renderJsonList(capability.contract.postconditions)}</div></div>
    </div>
  `
}

function renderJsonList(values: readonly unknown[]): string {
  return values.length === 0 ? `<p class="subtle">None returned</p>` : `<pre class="code-block code-block-compact">${escapeHtml(formatJson(values))}</pre>`
}

function renderVerification(view: DashboardViewModel): string {
  const summary = view.selectedVerification
  const progress = verificationProgress(summary)
  const missing = summary.missingEvidenceIds.length === 0
    ? ""
    : `<div class="alert alert-warning"><strong>Missing evidence:</strong> ${summary.missingEvidenceIds.map((id) => `<code>${escapeHtml(String(id))}</code>`).join(", ")}</div>`
  const failed = summary.failedEvidenceIds.length === 0
    ? ""
    : `<div class="alert alert-danger"><strong>Failed evidence:</strong> ${summary.failedEvidenceIds.map((id) => `<code>${escapeHtml(String(id))}</code>`).join(", ")}</div>`
  const runs = summary.runs.length === 0
    ? `<p class="empty-state">No verification runs are present on this replay projection.</p>`
    : `<div class="run-list">${summary.runs.map((run) => `
        <div class="run-row">
          <div><strong>${escapeHtml(String(run.id))}</strong><span class="subtle">Session ${escapeHtml(String(run.sessionId))} · ${run.freshSession ? "fresh session" : "not a fresh session"}</span></div>
          <div class="run-row-meta"><span class="status-badge status-${run.outcome === "success" ? "success" : "failure"}">${escapeHtml(run.outcome.toUpperCase())}</span><span class="subtle">${run.evidenceIds.length} evidence id${run.evidenceIds.length === 1 ? "" : "s"}</span></div>
          ${run.outcome === "failure" ? `<p class="run-failure">${escapeHtml(run.failureMessage)}</p>` : ""}
          <details><summary>Evidence references</summary><code>${escapeHtml(run.evidenceIds.map(String).join(", ") || "None returned")}</code></details>
        </div>
      `).join("")}</div>`
  return `<div class="verification-summary"><div class="progress-line"><strong>${escapeHtml(progress)}</strong><span class="subtle">${escapeHtml(summary.explanation)}</span></div>${missing}${failed}${runs}<p class="source-note">Posture, counts, run outcomes, and evidence references are reported by Worth Query.</p></div>`
}

function renderLineage(view: DashboardViewModel): string {
  if (view.selectedReplays.length === 0) return `<p class="empty-state">No replay lineage was returned for this capability.</p>`
  const replays = [...view.selectedReplays].reverse()
  return `<div class="timeline">${replays.map((replay, index) => {
    const verification = replay.verification
    return `
      <div class="timeline-item">
        <span class="timeline-marker"></span>
        <div class="timeline-content">
          <div class="timeline-heading"><strong>v${escapeHtml(String(replay.version))}</strong>${renderReplayBadge(replay)}<span class="confidence">${formatPercent(replay.confidence)} confidence</span></div>
          <p>${escapeHtml(replayStatusDescription(replay))}</p>
          <div class="lineage-facts"><span>Created ${escapeHtml(formatTimestamp(replay.createdAt))}</span>${replay.supersedes === undefined ? "" : `<span>Supersedes ${escapeHtml(String(replay.supersedes))}</span>`}${replay.supersededBy === undefined ? "" : `<span>Superseded by ${escapeHtml(String(replay.supersededBy))}</span>`}</div>
          <div class="timeline-verification">${renderVerificationBadge(verification.posture)}<span>${escapeHtml(verificationProgress(verification))}</span></div>
          ${replay.status === "active" ? `<details><summary>Active replay steps (${replay.steps.length})</summary><pre class="code-block">${escapeHtml(formatJson(replay.steps))}</pre></details>` : ""}
        </div>
      </div>
      ${index === replays.length - 1 ? "" : `<div class="timeline-connector"></div>`}
    `
  }).join("")}</div>`
}

function renderExecutions(view: DashboardViewModel): string {
  if (view.selectedExecutions.length === 0) return `<p class="empty-state">No execution projections were returned for this capability.</p>`
  return `<div class="execution-list">${view.selectedExecutions.map(renderExecution).join("")}</div>`
}

function renderExecution(execution: ExecutionProjection): string {
  const outcome = execution.status === "failure"
    ? execution.outcome.message
    : execution.status === "stopped"
      ? `Safety stop: ${execution.outcome.stop.reason}`
      : execution.status === "success"
        ? "Execution completed successfully"
        : "Execution is still running"
  return `
    <article class="execution-row">
      <div class="execution-heading"><div><strong>${escapeHtml(String(execution.id))}</strong><span class="subtle">${escapeHtml(execution.mode)}${execution.replayVersionId === undefined ? "" : ` · replay ${escapeHtml(String(execution.replayVersionId))}`}</span></div>${renderExecutionBadge(execution.status)}</div>
      <p class="execution-outcome">${escapeHtml(outcome)}</p>
      <div class="metric-strip">
        <span><strong>${escapeHtml(String(execution.metrics.modelCalls))}</strong> model calls</span>
        <span><strong>${escapeHtml(String(execution.metrics.inputTokens))}</strong> in tokens</span>
        <span><strong>${escapeHtml(String(execution.metrics.outputTokens))}</strong> out tokens</span>
        <span><strong>${execution.metrics.wallClockMs === undefined ? "—" : escapeHtml(formatDuration(execution.metrics.wallClockMs))}</strong> wall clock</span>
        <span><strong>${escapeHtml(formatMoney(execution.metrics.estimatedModelCostUsd))}</strong> est. model cost</span>
      </div>
      <details><summary>Browser metrics</summary><p class="subtle">${escapeHtml(String(execution.metrics.browserObservations))} observations · ${escapeHtml(String(execution.metrics.browserActions))} actions · started ${escapeHtml(formatTimestamp(execution.metrics.startedAt))}</p></details>
    </article>
  `
}

function renderEvidence(evidence: readonly EvidenceView[]): string {
  if (evidence.length === 0) return `<p class="empty-state">No evidence records were returned for this replay.</p>`
  const missingCount = evidence.filter((item) => item.posture === "missing").length
  const warning = missingCount === 0 ? "" : `<div class="alert alert-warning"><strong>${escapeHtml(String(missingCount))} missing record${missingCount === 1 ? "" : "s"}.</strong> Missing evidence is not treated as verified.</div>`
  return `${warning}<div class="evidence-list">${evidence.map((item) => `
    <article class="evidence-row evidence-${escapeHtml(item.posture)}">
      <div class="evidence-heading"><div><strong>${escapeHtml(item.label)}</strong><span class="subtle"><code>${escapeHtml(String(item.id))}</code></span></div><span class="status-badge status-${evidenceStatusClass(item.posture)}">${escapeHtml(evidenceStatusLabel(item.posture))}</span></div>
      <p>${escapeHtml(item.detail)}</p>
      ${renderReference(item.reference)}
      ${item.evidence === null ? "" : `<details><summary>Projection value</summary><pre class="code-block code-block-compact">${escapeHtml(formatJson(item.evidence))}</pre></details>`}
    </article>
  `).join("")}</div>`
}

function renderEconomics(economics: CapabilityEconomicsProjection | null): string {
  if (economics === null || economics.kind === "missing") {
    const reason = economics === null ? "No economics projection was returned for this capability." : economics.reason === "no_measured_runs" ? "No measured runs were returned by Worth." : "Worth has not made economics available yet."
    return `<div class="empty-state"><strong>No measured economics</strong><p>${escapeHtml(reason)}</p><p>Fixture or sample values are never displayed as measured cost.</p></div>`
  }
  const partial = economics.kind === "partial"
  const metrics = economics.metrics
  const missing = partial && economics.missing.length > 0 ? `<div class="alert alert-warning"><strong>Partial economics:</strong> ${economics.missing.map((field) => `<code>${escapeHtml(field)}</code>`).join(", ")} not returned.</div>` : ""
  return `${missing}<div class="economics-grid">
    ${economicsMetric("Compilation cost", metrics?.totalCompilationCostUsd)}
    ${economicsMetric("Exploration cost", metrics?.explorationCostUsd)}
    ${economicsMetric("Verification cost", metrics?.verificationCostUsd)}
    ${economicsMetric("Direct cost / call", metrics?.directAverageCostUsd)}
    ${economicsMetric("Compiled cost / call", metrics?.compiledAverageCostUsd)}
    <div class="economics-item"><span>Break-even</span><strong>${metrics?.breakEvenCalls === undefined ? "Not available" : renderBreakEven(metrics.breakEvenCalls)}</strong></div>
    ${economicsMetric("Lifetime direct cost avoided", economics.lifetime?.lifetimeDirectCostAvoidedUsd)}
    ${economicsMetric("Lifetime compiled cost", economics.lifetime?.lifetimeCompiledCostUsd)}
    <div class="economics-item"><span>Lifetime net savings</span><strong>${economics.lifetime === null ? "Not available" : formatMoney(economics.lifetime.lifetimeNetSavingsUsd)}</strong><small>${economics.lifetime === null ? "No lifetime projection" : `${escapeHtml(String(economics.lifetime.executions))} executions`}</small></div>
  </div><p class="source-note">Values shown here are Worth-reported projections from ${escapeHtml(String(economics.measuredExecutionIds.length))} measured execution id${economics.measuredExecutionIds.length === 1 ? "" : "s"}.</p>`
}

function economicsMetric(label: string, value: number | undefined): string {
  return `<div class="economics-item"><span>${escapeHtml(label)}</span><strong>${value === undefined ? "Not available" : formatMoney(value)}</strong></div>`
}

function renderBreakEven(breakEven: BreakEvenCalls): string {
  switch (breakEven.kind) {
    case "immediate":
      return `Immediate · ${formatMoney(breakEven.savingsPerCallUsd)}/call saved`
    case "finite":
      return `${escapeHtml(String(breakEven.calls))} calls <small>(exact ${escapeHtml(formatNumber(breakEven.exactCalls))})</small>`
    case "never":
      return `Never <small>(${escapeHtml(breakEven.reason.replaceAll("_", " "))})</small>`
    case "unavailable":
      return `Unavailable <small>(${escapeHtml(breakEven.reason.replaceAll("_", " "))})</small>`
  }
}

function renderBenchmark(view: DashboardViewModel): string {
  return `<div class="benchmark-grid"><div class="benchmark-column"><div class="benchmark-heading"><h3>Direct</h3>${renderBenchmarkState(view.projection.benchmark.direct)}</div>${renderBenchmarkValues(view.projection.benchmark.direct)}</div><div class="benchmark-column"><div class="benchmark-heading"><h3>Compiled</h3>${renderBenchmarkState(view.projection.benchmark.compiled)}</div>${renderBenchmarkValues(view.projection.benchmark.compiled)}</div></div><p class="source-note">Numbers appear only when returned by Worth as measured execution projections.</p>`
}

function renderBenchmarkState(side: BenchmarkSideProjection): string {
  const label = side.kind === "measured" ? "MEASURED" : side.kind === "partial" ? "PARTIAL" : "NO MEASURED RUNS"
  return `<span class="status-badge status-${side.kind === "measured" ? "success" : side.kind === "partial" ? "warning" : "neutral"}">${label}</span>`
}

function renderBenchmarkValues(side: BenchmarkSideProjection): string {
  if (side.kind === "missing") return `<p class="empty-state">${escapeHtml(side.reason === "no_measured_runs" ? "No measured runs returned." : "Runs are incomplete; metrics withheld.")}</p>`
  const values = side.values
  const fields: readonly [BenchmarkMetric, string, (value: number) => string][] = [
    ["modelCalls", "Model calls", (value) => formatNumber(value)],
    ["inputTokens", "Input tokens", (value) => formatNumber(value)],
    ["outputTokens", "Output tokens", (value) => formatNumber(value)],
    ["totalTokens", "Total tokens", (value) => formatNumber(value)],
    ["browserObservations", "Browser observations", (value) => formatNumber(value)],
    ["browserActions", "Browser actions", (value) => formatNumber(value)],
    ["wallClockMs", "Wall clock", (value) => formatDuration(value)],
    ["estimatedModelCostUsd", "Estimated model cost", (value) => formatMoney(value)],
  ]
  return `<dl class="benchmark-values">${fields.map(([field, label, formatter]) => `<div><dt>${escapeHtml(label)}</dt><dd>${values[field] === undefined ? `<span class="missing-value">Not measured</span>` : escapeHtml(formatter(values[field] as number))}</dd></div>`).join("")}</dl>${side.kind === "partial" ? `<p class="missing-note">Missing: ${side.missing.map((field) => escapeHtml(field)).join(", ")}</p>` : ""}`
}

function renderSessions(view: DashboardViewModel): string {
  if (view.projection.sessions.length === 0) return `<p class="empty-state">No Solari session projections were returned.</p>`
  return `<div class="session-list">${view.projection.sessions.map((session) => `
    <article class="session-row"><div class="session-heading"><div><strong>${escapeHtml(session.label)}</strong><span class="subtle">${escapeHtml(session.purpose)} · <code>${escapeHtml(String(session.id))}</code></span></div><span class="status-badge status-${sessionStatusClass(session.status)}">${escapeHtml(session.status.toUpperCase())}</span></div><p class="subtle">${session.startedAt === undefined ? "Start time not returned" : `Started ${escapeHtml(formatTimestamp(session.startedAt))}`}${session.endedAt === undefined ? "" : ` · ended ${escapeHtml(formatTimestamp(session.endedAt))}`}</p><p>${escapeHtml(String(session.evidenceIds.length))} evidence id${session.evidenceIds.length === 1 ? "" : "s"} returned</p>${renderReference(session.href)}</article>
  `).join("")}</div>`
}

function renderReference(reference: string | undefined): string {
  if (reference === undefined) return ""
  const safeReference = escapeHtml(reference)
  return /^https?:\/\//i.test(reference)
    ? `<a class="external-reference" href="${safeReference}" target="_blank" rel="noreferrer">Open projection reference ↗</a>`
    : `<span class="reference-value">Reference: <code>${safeReference}</code></span>`
}

function renderCapabilityStatus(capability: CapabilityProjection): string {
  return `<span class="status-badge status-${escapeHtml(capability.status)}">${escapeHtml(capability.status.toUpperCase())}</span>`
}

function renderReplayBadge(replay: DashboardReplayProjection): string {
  return `<span class="status-badge status-${escapeHtml(replay.status)}">${escapeHtml(replay.status.toUpperCase())}</span>`
}

function renderExecutionBadge(status: ExecutionProjection["status"]): string {
  return `<span class="status-badge status-${status === "success" ? "success" : status === "failure" ? "failure" : status === "stopped" ? "stopped" : "running"}">${escapeHtml(status === "stopped" ? "SAFETY STOP" : status.toUpperCase())}</span>`
}

function renderVerificationBadge(posture: VerificationPosture): string {
  const label = posture === "missing_evidence" ? "MISSING EVIDENCE" : posture === "not_started" ? "NOT STARTED" : posture === "unavailable" ? "NO REPLAY PROJECTION" : posture.toUpperCase()
  const style = posture === "verified" ? "success" : posture === "failed" || posture === "inconsistent" ? "failure" : posture === "missing_evidence" ? "warning" : posture === "superseded" || posture === "not_started" || posture === "unavailable" ? "neutral" : "provisional"
  return `<span class="status-badge status-${style}">${escapeHtml(label)}</span>`
}

function verificationHeadline(summary: DashboardViewModel["selectedVerification"]): string {
  if (summary.requiredSuccessfulRuns === null) return summary.posture === "not_started" ? "Not started" : summary.posture === "unavailable" ? "Not returned" : summary.posture.toUpperCase()
  return `${summary.successfulRuns}/${summary.requiredSuccessfulRuns}`
}

function verificationProgress(summary: Pick<DashboardViewModel["selectedVerification"], "posture" | "successfulRuns" | "requiredSuccessfulRuns">): string {
  if (summary.requiredSuccessfulRuns === null) {
    if (summary.posture === "unavailable") return "No replay verification projection"
    if (summary.posture === "not_started") return "Verification not started"
    return `${summary.posture.toUpperCase()} posture reported by Worth`
  }
  return `${summary.successfulRuns}/${summary.requiredSuccessfulRuns} successful runs`
}

function replayForCapability(view: DashboardViewModel, capabilityId: CapabilityProjection["id"]): DashboardReplayProjection | null {
  if (view.selectedCapabilityId !== null && String(capabilityId) === String(view.selectedCapabilityId)) return view.selectedReplay
  const capability = view.projection.capabilities.find((item) => item.capability.id === capabilityId)
  if (capability === undefined) return null
  return resolveCapabilityReplay(capability, view.projection.replays.filter((replay) => replay.capabilityId === capabilityId)).replay
}

function missingLifecyclePointer(capability: DashboardCapabilityProjection, view: DashboardViewModel): string {
  if (capability.capability.status === "discovering") return discoveryLabel(capability.capability.discovery)
  const resolution = resolveCapabilityReplay(capability, view.projection.replays.filter((replay) => replay.capabilityId === capability.capability.id)).resolution
  return resolution === "inconsistent_pointer" ? "Pointer inconsistent" : "Pointer missing"
}

function replayStatusDescription(replay: DashboardReplayProjection): string {
  switch (replay.status) {
    case "candidate":
      return "Candidate recorded; verification has not started."
    case "verifying":
      return `Worth reports verification in progress; ${verificationProgress(replay.verification)}.`
    case "active":
      return `Worth reports this replay active; verification recorded at ${formatTimestamp(replay.verifiedAt)}.`
    case "broken":
      return `Broken replay: ${replay.failure.message}`
    case "superseded":
      return `Superseded by ${String(replay.supersededBy)}.`
  }
}

function renderDiscoveryContext(discovery: DiscoveryReason): string {
  switch (discovery.kind) {
    case "initial":
      return `<div class="alert alert-warning"><strong>Initial discovery:</strong> Worth reports discovery in progress; no candidate replay projection has been returned.</div>`
    case "reexploration":
      return `<div class="alert alert-warning"><strong>Re-exploration:</strong> Worth reports discovery after replay <code>${escapeHtml(String(discovery.previousReplayVersionId))}</code> failed. ${renderFailureText(discovery.failure)}</div>`
    case "verification_failed":
      return `<div class="alert alert-danger"><strong>Verification failed:</strong> Worth reports re-discovery after candidate replay <code>${escapeHtml(String(discovery.candidateReplayVersionId))}</code> failed. ${renderFailureText(discovery.failure)}</div>`
  }
}

function discoveryLabel(discovery: DiscoveryReason): string {
  switch (discovery.kind) {
    case "initial":
      return "Initial discovery"
    case "reexploration":
      return "Re-exploration"
    case "verification_failed":
      return "Verification failed"
  }
}

function renderFailureText(failure: ReplayFailure): string {
  const evidence = failure.evidenceIds.length === 0 ? "" : ` Evidence: ${failure.evidenceIds.map((id) => `<code>${escapeHtml(String(id))}</code>`).join(", ")}.`
  return `<span>${escapeHtml(failure.message)}</span>${evidence}`
}

function evidenceStatusClass(posture: EvidenceView["posture"]): "success" | "failure" | "warning" {
  return posture === "present" ? "success" : posture === "failed" ? "failure" : "warning"
}

function evidenceStatusLabel(posture: EvidenceView["posture"]): string {
  return posture === "present" ? "PRESENT" : posture === "failed" ? "FAILED" : "MISSING"
}

function sessionStatusClass(status: "active" | "closed" | "failed" | "unknown"): "success" | "failure" | "warning" | "neutral" {
  return status === "active" ? "success" : status === "failed" ? "failure" : status === "unknown" ? "warning" : "neutral"
}

function modeExplanation(mode: DashboardMode): string {
  switch (mode) {
    case "direct":
      return "Requests are being handled directly without a compiled replay."
    case "discovering":
      return "Solari is exploring the application to discover a capability."
    case "compiled":
      return "Trusted replay versions are handling requests."
    case "degraded":
      return "A trusted path has failed; the projection indicates a degraded state."
    case "exploring":
      return "The system is re-exploring after degradation or failure."
    case "verifying":
      return "A candidate replay is collecting independent verification runs."
  }
}

function unavailableMessage(reason: "not_configured" | "not_admitted" | "unsupported"): string {
  switch (reason) {
    case "not_configured":
      return "No read-only Worth query was injected into the browser."
    case "not_admitted":
      return "The Worth query is not admitted to return this projection."
    case "unsupported":
      return "The connected Worth query does not support this dashboard projection."
  }
}

function formatMoney(value: number): string {
  return Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value) : "Not available"
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "Not available"
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value) : "Not available"
}

function formatDuration(milliseconds: number): string {
  return Number.isFinite(milliseconds) ? `${formatNumber(milliseconds)} ms` : "Not available"
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "Not available"
}
