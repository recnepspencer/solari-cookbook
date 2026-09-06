import { createHash } from "node:crypto"
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))
const port = Number(process.env.ENRON_ONLINE_PORT || 4310)
const host = process.env.ENRON_ONLINE_HOST === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1"
const release = process.env.ENRON_ONLINE_RELEASE === "v2" ? "v2" : "v1"
const indexTemplate = readFileSync(resolve(root, "index.html"), "utf8")

const fixture = Object.freeze({
  id: "msg.enron-mailroom.2026-10-1042",
  from: "nominations@midwestutility.example",
  subject: "Confirmed October Henry Hub purchase — attach to Financials",
  attachmentName: "midwest-utility-october.csv",
  csv: "counterparty,instrument,delivery_month,quantity,price,currency\nMidwest Utility 17,NG-HH-2026-10,2026-10,50000,3.18,USD\n",
})
const attachmentSha256 = createHash("sha256").update(fixture.csv).digest("hex")

let delivered = false
const receipts = new Map()

function respond(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(value))
}

function state() {
  return {
    release,
    message: {
      id: fixture.id,
      from: fixture.from,
      subject: fixture.subject,
      attachmentName: fixture.attachmentName,
      attachmentSha256,
      delivered,
    },
    receipts: [...receipts.values()],
  }
}

function staticTarget(pathname) {
  const target = resolve(root, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""))
  const fromRoot = relative(root, target)
  return fromRoot.startsWith("..") || fromRoot === "" || !existsSync(target) || !statSync(target).isFile() ? null : target
}

createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname
  if (pathname === "/api/state" && request.method === "GET") return respond(response, 200, state())
  if (pathname === "/api/reset" && request.method === "POST") {
    delivered = false
    receipts.clear()
    return respond(response, 200, state())
  }
  if (pathname === "/api/deliver" && request.method === "POST") {
    delivered = true
    return respond(response, 200, state())
  }
  if (pathname === "/api/ingest" && request.method === "POST") {
    if (!delivered) return respond(response, 409, { error: "message_not_delivered" })
    const idempotencyKey = `${fixture.id}:${attachmentSha256}`
    const existing = receipts.get(idempotencyKey)
    if (existing !== undefined) return respond(response, 200, { receipt: existing, duplicate: true })
    const receipt = {
      tradeId: "FT-1042",
      financialReceiptId: "FIN-1042",
      status: "posted",
      sourceMessageId: fixture.id,
      idempotencyKey,
      counterparty: "Midwest Utility 17",
      instrument: "NG-HH-2026-10",
      deliveryMonth: "2026-10",
      quantity: 50000,
      price: 3.18,
      currency: "USD",
    }
    receipts.set(idempotencyKey, receipt)
    return respond(response, 201, { receipt, duplicate: false })
  }

  const target = staticTarget(pathname)
  if (target === null) {
    response.writeHead(404)
    response.end("Not found")
    return
  }
  const contentType = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" }[extname(target)] || "application/octet-stream"
  response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" })
  if (extname(target) === ".html") {
    const initialState = JSON.stringify(state()).replaceAll("<", "\\u003c")
    response.end(indexTemplate.replace("__ENRON_INITIAL_STATE__", initialState))
    return
  }
  createReadStream(target).pipe(response)
}).listen(port, host, () => console.log(`Solari UI API Builder demo: http://${host}:${port}`))
