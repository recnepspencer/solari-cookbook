(() => {
  const release = new URLSearchParams(location.search).get("release") === "v2" ? "v2" : "v1";
  const staged = { current: null };
  document.querySelector("#release").textContent = release;
  document.querySelector("#stage-v1").hidden = release !== "v1";
  document.querySelector("#stage-v2").hidden = release !== "v2";
  const stage = () => {
    const counterparty = document.querySelector("#counterparty").value;
    const market = document.querySelector("#market").value;
    const volume = Number(document.querySelector("#volume").value);
    const code = document.querySelector("#deal-code").value.trim();
    if (!counterparty || !Number.isFinite(volume) || volume <= 0 || !code) { document.querySelector("#stage-result").textContent = "E-104: complete counterparty, volume, and legacy deal code."; return; }
    staged.current = `ET-${market === "henry-hub-gas" ? "NG" : "PW"}-1042`;
    document.querySelector("#stage-result").textContent = `STAGED ${staged.current} / ${volume.toLocaleString()} MMBtu / ${code}`;
    document.querySelector("#risk-button").disabled = false;
    document.querySelector("#risk-result").textContent = `Ticket ${staged.current} is eligible for risk submission.`;
  };
  document.querySelector("#stage-v1").addEventListener("click", stage);
  document.querySelector("#stage-v2").addEventListener("click", stage);
  document.querySelector("#risk-button").addEventListener("click", () => { if (staged.current) document.querySelector("#risk-result").textContent = `RISK QUEUED / ${staged.current} / status: PENDING_LIMIT_REVIEW`; });
  document.querySelector("#clear").addEventListener("click", () => { staged.current = null; document.querySelector("#stage-result").textContent = "No deal ticket is staged."; document.querySelector("#risk-button").disabled = true; document.querySelector("#risk-result").textContent = "Waiting for a staged ticket."; });
})();
