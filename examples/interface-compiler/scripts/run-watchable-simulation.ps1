[CmdletBinding()]
param(
  [ValidateSet('recovery')]
  [string] $Scenario = 'recovery'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$environmentFile = Join-Path $repositoryRoot '.env'
$service = 'simulation-recovery'
$profile = 'recovery'

function Require-Command([string] $Name, [string] $Hint) {
  if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing prerequisite '$Name'. $Hint"
  }
}

function Invoke-Checked([string] $Program, [string[]] $Arguments, [string] $FailureMessage) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code $LASTEXITCODE)."
  }
}

function Test-EnvironmentValue([string] $Name) {
  $match = Select-String -LiteralPath $environmentFile -Pattern "^$([regex]::Escape($Name))=.+$" -Quiet
  if (-not $match) {
    throw "Set a non-empty '$Name' in the ignored .env file before starting a live simulation. See env.example."
  }
}

function Wait-ForPublicPortal([string] $PortalOrigin) {
  $probe = 'fetch(`${process.env.PORTAL_ORIGIN}/api/state`, { signal: AbortSignal.timeout(5000) }).then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))'
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    & docker run --rm --dns 1.1.1.1 --env "PORTAL_ORIGIN=$PortalOrigin" interface-compiler-portal:latest node --input-type=module --eval $probe 2>$null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 1
  }
  throw 'Cloudflare published a tunnel URL but it did not become publicly reachable. Inspect `docker compose logs tunnel`, then rerun this script.'
}

Require-Command docker 'Install Docker Desktop, then rerun this script.'
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  throw "Missing '$environmentFile'. Create it from env.example and add your provider credentials."
}
Test-EnvironmentValue 'SOLARI_API_KEY'
Test-EnvironmentValue 'GEMINI_API_KEY'

$previousRelease = $env:ENRON_ONLINE_RELEASE
try {
  $env:ENRON_ONLINE_RELEASE = 'v2'
  Invoke-Checked docker @('compose', '--profile', 'portal', '--profile', 'tunnel', 'up', '--build', '--force-recreate', '--detach', 'portal', 'tunnel') 'Could not start the local portal and public tunnel'

  $tunnelUrl = $null
  for ($attempt = 0; $attempt -lt 30 -and $null -eq $tunnelUrl; $attempt += 1) {
    Start-Sleep -Seconds 1
    $logs = & docker compose --profile portal --profile tunnel logs --no-log-prefix tunnel 2>$null
    $match = [regex]::Match(($logs -join "`n"), 'https://[-a-z0-9]+\.trycloudflare\.com')
    if ($match.Success) { $tunnelUrl = $match.Value }
  }
  if ($null -eq $tunnelUrl) {
    throw 'Cloudflare did not report a public tunnel URL. Inspect `docker compose logs tunnel`, then rerun this script.'
  }
  Wait-ForPublicPortal $tunnelUrl

  $watchUrl = 'http://127.0.0.1:4310/?page=mail'
  Write-Host "Watching portal: $watchUrl"
  Write-Host "Solari portal origin: $tunnelUrl"
  Start-Process $watchUrl
  Invoke-Checked docker @('compose', '--profile', 'portal', '--profile', $profile, 'run', '--build', '--rm', '--no-deps', '-e', "ENRON_ONLINE_BASE_URL=$tunnelUrl", $service) "Live $Scenario simulation failed"
} finally {
  $env:ENRON_ONLINE_RELEASE = $previousRelease
}
