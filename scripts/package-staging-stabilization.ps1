# ==============================================================================
# ORVA STORE — Staging Stabilization Package (zero secrets)
# Target: staging.orva-store.com document root only
# Does NOT include .env, secret-keys, secure-config, or inventory-state.json
# ==============================================================================

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "dist-staging-stabilization"
$zipFile = Join-Path $root "orva-store-staging-stabilization.zip"
$manifestFile = Join-Path $root "STAGING_DEPLOYMENT_MANIFEST.md"
$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC"

if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
if (Test-Path $zipFile) { Remove-Item -Force $zipFile }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$files = @(
    @{ Src = "api\send-order.php"; Dest = "api\send-order.php" },
    @{ Src = "api\delivery.php"; Dest = "api\delivery.php" },
    @{ Src = "api\auth.php"; Dest = "api\auth.php" },
    @{ Src = "api\admin-settings.php"; Dest = "api\admin-settings.php" },
    @{ Src = "api\config.php"; Dest = "api\config.php" },
    @{ Src = "api\codflow.php"; Dest = "api\codflow.php" },
    @{ Src = "api\publish-page.php"; Dest = "api\publish-page.php" },
    @{ Src = "api\analytics.php"; Dest = "api\analytics.php" },
    @{ Src = "lib\inventory-store.php"; Dest = "lib\inventory-store.php" },
    @{ Src = "lib\admin-session.php"; Dest = "lib\admin-session.php" },
    @{ Src = "packs-client.js"; Dest = "packs-client.js" },
    @{ Src = "script.js"; Dest = "script.js" },
    @{ Src = "data\products-catalog.json"; Dest = "data\products-catalog.json" },
    @{ Src = "data\algeria-communes.json"; Dest = "data\algeria-communes.json" },
    @{ Src = "data\wilayas-tariffs.json"; Dest = "data\wilayas-tariffs.json" }
)

$copied = @()
foreach ($item in $files) {
    $src = Join-Path $root $item.Src
    if (-not (Test-Path $src)) {
        throw "Missing required file: $($item.Src)"
    }
    $dest = Join-Path $outDir $item.Dest
    $destParent = Split-Path -Parent $dest
    if (-not (Test-Path $destParent)) {
        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
    }
    Copy-Item -Path $src -Destination $dest -Force
    $hash = (Get-FileHash -Algorithm SHA256 -Path $src).Hash.Substring(0, 16)
    $len = (Get-Item $src).Length
    $copied += [PSCustomObject]@{
        Path = $item.Dest.Replace('\', '/')
        Bytes = $len
        Sha256Prefix = $hash
    }
    Write-Host "OK $($item.Dest) ($len bytes, sha256:$hash...)"
}

# Explicit exclusions note file inside package
$excludeNote = @"
EXCLUDED FROM THIS PACKAGE (do not upload from local workspace):
- .env / .env.local / any secret files
- data/private/**
- data/inventory-state.json  (preserve Staging inventory; reconcile separately)
- data/idempotency-records.json
- data/telegram-dispatch-ledger.json
- backups/**
- node_modules/**
- codflow-main/**
- Production public_html root
"@
Set-Content -Path (Join-Path $outDir "STAGING_PACKAGE_EXCLUSIONS.txt") -Value $excludeNote -Encoding UTF8

Push-Location $outDir
tar -a -c -f $zipFile *
Pop-Location

$zipMB = [math]::Round(((Get-Item $zipFile).Length / 1MB), 3)
$manifest = @"
# Staging Stabilization Deployment Manifest

Generated: $ts
Package: ``orva-store-staging-stabilization.zip`` ($zipMB MB)
Target host: ``https://staging.orva-store.com``
Target directory (Hostinger): ``/home/u520776094/domains/orva-store.com/public_html/staging``
Production root: DO NOT TOUCH ``/home/u520776094/domains/orva-store.com/public_html/``

## Files included

| Path | Bytes | SHA256 (prefix) |
|------|------:|-----------------|
$(($copied | ForEach-Object { "| ``$($_.Path)`` | $($_.Bytes) | ``$($_.Sha256Prefix)`` |" }) -join "`n")

## Explicitly excluded

- Secrets (``.env``, ``secure-config.php``, ``secret-keys.php``, ``data/private/**``)
- ``data/inventory-state.json`` (preserve Staging stock ledger; local file has 49 Pack1 reservations pending reconcile)
- Idempotency / telegram ledgers
- Full dashboard rebuild / ``admin/`` (not required for these PHP/checkout fixes)

## Pre-deploy backup checklist (Staging only)

Before replacing each file on Staging, copy the live file to:

``/home/u520776094/domains/orva-store.com/public_html/staging/_backup_stabilization_YYYYMMDD/``

Minimum backups:
$(($copied | ForEach-Object { "- ``$($_.Path)``" }) -join "`n")
- ``data/inventory-state.json`` (even though not replaced)
- ``data/private/`` (permissions only; do not download secrets into Git)

## Deploy steps (Hostinger MCP unavailable in this session)

1. Open Hostinger hPanel → Files → ``public_html/staging``.
2. Create backup folder ``_backup_stabilization_YYYYMMDD``.
3. Move/copy current versions of the listed files into the backup folder.
4. Upload and extract ``orva-store-staging-stabilization.zip`` into ``public_html/staging`` (merge/overwrite listed paths only).
5. Confirm ``lib/inventory-store.php`` and ``lib/admin-session.php`` exist.
6. Confirm Staging secure config outside web root still sets:
   - ``APP_ENV=staging``
   - ``SUPABASE_SCHEMA=staging``
   - ``SUPABASE_STAGING_TOKEN=...`` (staging_user JWT)
   - Do **not** set ``SUPABASE_SERVICE_ROLE_KEY`` on Staging.
7. Run focused Staging tests from the status report.

## Rollback

Restore files from ``_backup_stabilization_YYYYMMDD`` over the same paths.
"@

Set-Content -Path $manifestFile -Value $manifest -Encoding UTF8
Write-Host ""
Write-Host "Package: $zipFile ($zipMB MB)"
Write-Host "Manifest: $manifestFile"
