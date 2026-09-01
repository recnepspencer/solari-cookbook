import { normalizeObservation, type Clock, type IdSource, type Interactable, type Observation, type SessionId, type ValidationResult } from "@interface-compiler/domain"
import type { SolariDomElement, SolariSdkPage } from "./solari-sdk.js"

const INTERACTABLE_SELECTOR = "a,button,input,select,form,table,[role]"
const MAX_TEXT_LENGTH = 200

export async function readPageObservation(
  page: SolariSdkPage,
  sessionId: SessionId,
  clock: Clock,
  idSource: IdSource,
): Promise<ValidationResult<Observation>> {
  const url = page.url()
  const title = await page.title()
  const interactables = await readInteractables(page)
  const observation = {
    id: idSource.nextObservationId(),
    sessionId,
    url,
    ...(title.trim() === "" ? {} : { title: boundedText(title) }),
    interactables,
    observedAt: clock.now(),
  } satisfies Observation
  return normalizeObservation(observation)
}

async function readInteractables(page: SolariSdkPage): Promise<readonly Interactable[]> {
  const locator = page.locator(INTERACTABLE_SELECTOR)
  const rows = await locator.evaluateAll((elements: readonly SolariDomElement[]) => elements.map((element) => ({
    tagName: element.tagName,
    role: element.getAttribute("role"),
    name: element.getAttribute("aria-label") ?? element.getAttribute("name"),
    text: element.textContent,
  })))

  return rows.map((row) => {
    const text = boundedText(row.text ?? "")
    const name = boundedText(row.name ?? "")
    const role = boundedText(row.role ?? "")
    const semanticGuess = name || text || role || undefined
    return {
      kind: interactableKind(row.tagName, row.role),
      ...(role === "" ? {} : { role }),
      ...(name === "" ? {} : { name }),
      ...(text === "" ? {} : { text }),
      ...(semanticGuess === undefined ? {} : { semanticGuess }),
    }
  })
}

function interactableKind(tagName: string, role: string | null): Interactable["kind"] {
  const normalizedRole = role?.toLowerCase()
  if (normalizedRole === "button") return "button"
  if (normalizedRole === "link") return "link"
  if (normalizedRole === "textbox" || normalizedRole === "searchbox") return "input"
  if (normalizedRole === "combobox") return "select"
  switch (tagName.toLowerCase()) {
    case "a": return "link"
    case "button": return "button"
    case "input": return "input"
    case "select": return "select"
    case "form": return "form"
    case "table": return "table"
    default: return "other"
  }
}

function boundedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH)
}
