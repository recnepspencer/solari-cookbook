import "./styles.css"
import type { WorthDashboardQuery } from "./dashboard-contract.js"
import { mountDashboard } from "./controller.js"
import { renderDashboardResult } from "./render.js"

declare global {
  interface Window {
    interfaceCompilerWorthQuery?: WorthDashboardQuery
  }
}

const root = document.querySelector<HTMLElement>("#dashboard-root")
if (root === null) {
  throw new Error("Dashboard root element was not found")
}

const query = window.interfaceCompilerWorthQuery
if (query === undefined) {
  root.innerHTML = renderDashboardResult({ kind: "unavailable", reason: "not_configured" })
} else {
  mountDashboard(root, query)
}
