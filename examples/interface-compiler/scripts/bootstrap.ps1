[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$worthRemote = 'https://github.com/recnepspencer/worth.git'
$worthCommit = 'a09f241c615cc41c541ba91968efdecb1ad78e61'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$worthRoot = Join-Path $repositoryRoot '.local/worth'
$worthHostManifest = Join-Path $worthRoot 'workspaces/worth-query/crates/worth-query-host/Cargo.toml'
$runtimeManifest = Join-Path $repositoryRoot 'worth-runtime-host/Cargo.toml'
$dashboardDirectory = Join-Path $repositoryRoot 'apps/dashboard'

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

function Test-MatchingWorthRemote([string] $Directory) {
  $remote = (& git -C $Directory remote get-url origin | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read the origin remote for '$Directory'. Remove or repair that checkout, then rerun bootstrap."
  }
  if ($remote -ne $worthRemote) {
    throw "'$Directory' is not the expected WORTH checkout. Expected origin '$worthRemote'; found '$remote'. Move that directory aside or clone the expected repository there, then rerun bootstrap."
  }
}

function Set-PinnedWorthCommit([string] $Directory) {
  $changes = (& git -C $Directory status --porcelain | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect WORTH checkout '$Directory'."
  }
  if ($changes.Length -gt 0) {
    throw "WORTH checkout '$Directory' has local changes and cannot be moved to pinned commit '$worthCommit'. Commit or discard those changes, then rerun bootstrap."
  }
  Invoke-Checked git @('-C', $Directory, 'fetch', '--depth', '1', 'origin', $worthCommit) 'Could not fetch the pinned WORTH commit'
  Invoke-Checked git @('-C', $Directory, 'checkout', '--detach', $worthCommit) 'Could not check out the pinned WORTH commit'
  $actualCommit = (& git -C $Directory rev-parse HEAD | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $worthCommit) {
    throw "WORTH checkout '$Directory' is not pinned to '$worthCommit'."
  }
}

function Clone-WorthCheckout {
  $localDirectory = Split-Path -Parent $worthRoot
  $stagingDirectory = "$worthRoot.bootstrap-$PID"
  New-Item -ItemType Directory -Force -Path $localDirectory | Out-Null

  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
  }

  try {
    Write-Host "Cloning WORTH commit $worthCommit into $worthRoot"
    Invoke-Checked git @('init', '--initial-branch=pinned-source', $stagingDirectory) 'Could not initialize the WORTH checkout'
    Invoke-Checked git @('-C', $stagingDirectory, 'remote', 'add', 'origin', $worthRemote) 'Could not configure the WORTH remote'
    Set-PinnedWorthCommit $stagingDirectory
    Test-MatchingWorthRemote $stagingDirectory
    if (-not (Test-Path -LiteralPath (Join-Path $stagingDirectory 'workspaces/worth-query/crates/worth-query-host/Cargo.toml') -PathType Leaf)) {
      throw "The cloned WORTH checkout does not contain 'workspaces/worth-query/crates/worth-query-host/Cargo.toml'. Confirm the WORTH repository layout, then rerun bootstrap."
    }
    Move-Item -LiteralPath $stagingDirectory -Destination $worthRoot
  } finally {
    if (Test-Path -LiteralPath $stagingDirectory) {
      Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
    }
  }
}

Require-Command git 'Install Git, then rerun scripts/bootstrap.ps1.'
Require-Command node 'Install a current Node.js release with npm, then rerun scripts/bootstrap.ps1.'
Require-Command npm 'Install npm with Node.js, then rerun scripts/bootstrap.ps1.'
Require-Command cargo 'Install Rust/Cargo compatible with WORTH, then rerun scripts/bootstrap.ps1.'

if (-not (Test-Path -LiteralPath $runtimeManifest -PathType Leaf)) {
  throw "Could not find '$runtimeManifest'. Run this script from the checked-out Interface Compiler repository."
}
if (-not (Test-Path -LiteralPath $dashboardDirectory -PathType Container)) {
  throw "Could not find '$dashboardDirectory'. The Interface Compiler checkout is incomplete."
}

$expectedDependency = 'worth-query-host = { path = "../.local/worth/workspaces/worth-query/crates/worth-query-host" }'
if ((Get-Content -LiteralPath $runtimeManifest -Raw).IndexOf($expectedDependency, [System.StringComparison]::Ordinal) -lt 0) {
  throw "'$runtimeManifest' does not use the repository-local WORTH dependency path. Restore the tracked manifest, then rerun bootstrap."
}

if (Test-Path -LiteralPath $worthRoot) {
  if (-not (Test-Path -LiteralPath (Join-Path $worthRoot '.git') -PathType Any)) {
    throw "'$worthRoot' already exists but is not a Git checkout. Move it aside, then rerun bootstrap."
  }
  Test-MatchingWorthRemote $worthRoot
  if (-not (Test-Path -LiteralPath $worthHostManifest -PathType Leaf)) {
    Write-Host "Replacing incomplete WORTH checkout: $worthRoot"
    Remove-Item -LiteralPath $worthRoot -Recurse -Force
    Clone-WorthCheckout
  } else {
    Set-PinnedWorthCommit $worthRoot
    Write-Host "Using existing WORTH checkout: $worthRoot"
  }
} else {
  Clone-WorthCheckout
}

if (-not (Test-Path -LiteralPath $worthHostManifest -PathType Leaf)) {
  throw "WORTH checkout '$worthRoot' does not contain 'workspaces/worth-query/crates/worth-query-host/Cargo.toml'. It may be the wrong revision or repository layout. Confirm the WORTH repository layout, then rerun bootstrap."
}

Write-Host 'Installing root npm dependencies'
Invoke-Checked npm @('install') 'Root npm dependency installation failed'

Write-Host 'Installing dashboard npm dependencies'
Invoke-Checked npm @('install', '--prefix', $dashboardDirectory) 'Dashboard npm dependency installation failed'

Write-Host 'Building the local WORTH runtime host'
Invoke-Checked cargo @('build', '--manifest-path', $runtimeManifest) 'WORTH runtime host build failed'

Write-Host ''
Write-Host 'Bootstrap complete.'
Write-Host 'No credentials were read or written. The deterministic local WORTH checkout is .local/worth.'
Write-Host 'Run npm test for no-cost checks, or see SETUP.md before live Solari/Gemini scenarios.'
