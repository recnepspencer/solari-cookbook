(() => {
  const pages = { mail: true, financials: true, control: true }
  const initialStateElement = document.getElementById("initial-state")
  const initialStateText = initialStateElement?.textContent || ""
  const initialState = initialStateText === "__ENRON_INITIAL_STATE__" ? null : JSON.parse(initialStateText)
  const state = { page: new URLSearchParams(location.search).get("page") || "mail", data: initialState }
  const byId = (id) => document.getElementById(id)

  async function request(url, options) {
    const response = await fetch(url, options)
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }

  function show(page) {
    state.page = pages[page] ? page : "mail"
    document.querySelectorAll("[data-page]").forEach((element) => { element.hidden = element.dataset.page !== state.page })
    document.querySelectorAll("[data-nav]").forEach((element) => element.classList.toggle("active", element.dataset.nav === state.page))
    history.replaceState({}, "", `?page=${state.page}`)
  }

  function renderFinancials(receipts) {
    const body = byId("financials-body")
    if (receipts.length === 0) {
      body.innerHTML = '<tr><td colspan="7" class="empty">No Financials trades posted.</td></tr>'
      return
    }
    body.innerHTML = receipts.map((receipt) => `<tr><td>${receipt.tradeId}</td><td>${receipt.counterparty}</td><td>${receipt.instrument}</td><td>${receipt.deliveryMonth}</td><td>${receipt.quantity.toLocaleString()} MMBtu @ $${receipt.price}</td><td>${receipt.financialReceiptId}</td><td class="green">${receipt.status.toUpperCase()}</td></tr>`).join("")
  }

  function renderControlPlane(release) {
    byId("active-release").textContent = release
    byId("worth-posture").textContent = release === "v2"
      ? "Health: HEALTHY · verification evidence: 3 fresh Solari sessions · replacement history: v1 degraded → v2 active"
      : "Recovery drill ready: v1 is intentionally stale. Run the recovery launcher to see v2 activated after three fresh Solari sessions."
  }

  function render() {
    if (!state.data) return
    const { message, receipts, release } = state.data
    byId("mail-subject").textContent = message.delivered ? message.subject : "Awaiting delivered trade"
    byId("mail-from").textContent = message.delivered ? `EMAIL RECEIVED · From: ${message.from}` : "No source message is currently in the inbox."
    byId("attachment").textContent = message.delivered ? `${message.attachmentName} · sha256:${message.attachmentSha256.slice(0, 16)}…` : "—"
    byId("message-id").textContent = message.delivered ? message.id : "—"
    byId("ingest-v2").disabled = !message.delivered
    renderFinancials(receipts)
    renderControlPlane(release)
  }

  async function refresh() {
    state.data = await request("/api/state")
    render()
  }

  byId("deliver").addEventListener("click", async () => {
    await request("/api/deliver", { method: "POST" })
    await refresh()
    byId("mail-result").textContent = `EMAIL RECEIVED / ${state.data.message.id} / CSV attachment available for semantic ingestion.`
    byId("timeline").textContent = "email received → awaiting capability call"
  })

  byId("ingest-v2").addEventListener("click", async () => {
    const result = await request("/api/ingest", { method: "POST" })
    await refresh()
    const receipt = result.receipt
    byId("mail-result").textContent = `${result.duplicate ? "DUPLICATE" : "POSTED"} ${receipt.tradeId} / verified Financials receipt ${receipt.financialReceiptId} / source ${receipt.sourceMessageId} / idempotency ${receipt.idempotencyKey}`
    byId("timeline").textContent = "email received → attachment validated → trade normalized → Financials posted → receipt verified"
    byId("idempotency").textContent = `${result.duplicate ? "Duplicate suppressed" : "New post"}: ${receipt.idempotencyKey}`
  })

  byId("reset").addEventListener("click", async () => {
    await request("/api/reset", { method: "POST" })
    await refresh()
    byId("mail-result").textContent = "Demo state reset."
  })

  document.querySelectorAll("[data-nav]").forEach((element) => element.addEventListener("click", (event) => {
    event.preventDefault()
    show(element.dataset.nav)
  }))

  render()
  show(state.page)
  refresh().catch(() => { byId("mail-result").textContent = "E-500: portal state could not be loaded." })
  setInterval(() => void refresh(), 1000)
})()
