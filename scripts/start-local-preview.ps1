# ORVA STORE — Localhost preview (no Git push, no Hostinger, no hosted DB)
# Starts:
#   Node storefront/API (JS): http://localhost:3000
#   PHP API + static:         http://127.0.0.1:8000
#
# Synthetic local config: data/private/local-secure-config.php

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:APP_ENV = "local"
$env:SUPABASE_SCHEMA = "staging"
$env:STAGING_USE_PDO = "true"
$env:STAGING_PDO_MODE = "mock"
$env:STAGING_PDO_ALLOW_LIVE = "false"
$env:ORVA_TEST_MOCK_SUPABASE = "true"
$env:ADMIN_PASSWORD = "local-dev-admin-password"
$env:ADMIN_API_TOKEN = "local-dev-admin-token"
$env:PORT = "3000"

Write-Host "ORVA local preview"
Write-Host "  Node:  http://localhost:3000"
Write-Host "  PHP:   http://127.0.0.1:8000"
Write-Host "  Admin: http://127.0.0.1:8000/admin/dashboard/default/"
Write-Host "  Status:http://127.0.0.1:8000/api/local-dev-status.php"
Write-Host "  PDO tests use MOCK only (hosted Supabase blocked)."

Start-Process -FilePath "node" -ArgumentList "dev-server.js" -WorkingDirectory $Root -WindowStyle Minimized
Start-Process -FilePath "php" -ArgumentList @("-S", "127.0.0.1:8000", "scripts/php-local-router.php") -WorkingDirectory $Root -WindowStyle Minimized

Write-Host "Servers launched in minimized windows. Close those windows to stop."
