# P1-Y: run from the repository root on your own trusted Windows machine.
# OFFLINE by default; -Live needs explicit owner action and distinct READ-only API tokens.
# No Cloudflare write/deploy/cron/OAuth action. Never paste secrets in chat or GitHub.
param([switch]$Live)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
try {
    if (-not $Live) {
        & node scripts/cloudflare-owner-acceptance.mjs
        exit $LASTEXITCODE
    }
    $accountId = Read-Host 'Cloudflare account ID (private, do not share)'
    $inventorySecret = Read-Host 'Inventory READ-only API token' -AsSecureString
    $billingSecret = Read-Host 'Separate BILLING READ API token' -AsSecureString
    try {
        $env:CF_READONLY_ACCOUNT_ID = $accountId
        $env:CF_BILLING_ACCOUNT_ID = $accountId
        $env:CF_READONLY_API_TOKEN = [System.Net.NetworkCredential]::new('', $inventorySecret).Password
        $env:CF_BILLING_READ_TOKEN = [System.Net.NetworkCredential]::new('', $billingSecret).Password
        # This emits ONLY the consolidated allowlisted flags. A 0 exit code
        # means GET metadata was complete, NEVER 'safe to deploy'.
        & node scripts/cloudflare-owner-acceptance.mjs --inspect-live
        $inspectionExitCode = $LASTEXITCODE
    } finally {
        Remove-Item Env:CF_READONLY_API_TOKEN -ErrorAction SilentlyContinue
        Remove-Item Env:CF_BILLING_READ_TOKEN -ErrorAction SilentlyContinue
        Remove-Item Env:CF_READONLY_ACCOUNT_ID -ErrorAction SilentlyContinue
        Remove-Item Env:CF_BILLING_ACCOUNT_ID -ErrorAction SilentlyContinue
        Remove-Variable inventorySecret,billingSecret,accountId -ErrorAction SilentlyContinue
    }
    exit $inspectionExitCode
} finally {
    Pop-Location
}
