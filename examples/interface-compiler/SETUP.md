# Setup

Install Git, Node.js/npm, Rust/Cargo, and Docker Desktop. From this directory run:

```powershell
pwsh -File .\scripts\bootstrap.ps1
```

Bootstrap installs dependencies, checks out the exact WORTH revision required by this demo into ignored `.local/worth`, and builds the host. It does not read or write credentials.

For the local deterministic demo:

```powershell
docker compose --profile portal up --build
```

Open `http://127.0.0.1:4310/?page=mail`. Deliver the source message, use the Financials action, then repeat it to see the duplicate outcome. The portal is intentionally in-memory.

For the live recovery drill, copy `env.example` to ignored `.env` and set `SOLARI_API_KEY`. Then run:

```powershell
pwsh -File .\scripts\run-watchable-simulation.ps1 -Scenario recovery
```

The launcher starts the portal plus a temporary public tunnel, opens the Mailroom locally, and runs stale v1 → WORTH degradation → three fresh Solari v2 verifications → activation → successful rerun. It uses Solari but does not require Gemini.

Run deterministic verification with `npm test`, `npm run typecheck`, and `cargo test --manifest-path worth-runtime-host/Cargo.toml`.
