# Full Staging site package = storefront + stabilized APIs.
# Excludes secrets. Uses clean staging inventory seed (no 49 Pack1 reservations).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "dist-staging-full"
$zipFile = Join-Path $root "orva-store-staging-full_$((Get-Date).ToString('yyyyMMdd_HHmmss')).zip"

if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# Overlay stabilization package first (authoritative stabilized files)
$stab = Join-Path $root "dist-staging-stabilization"
if (-not (Test-Path $stab)) { throw "Missing dist-staging-stabilization. Run package-staging-stabilization.ps1 first." }
Copy-Item -Path (Join-Path $stab "*") -Destination $outDir -Recurse -Force

$rootFiles = @(
  "index.html","pack1.html","pack2.html","yamaha-archive.html",
  "styles.css","packs-styles.css","packs-config.js","algeria-communes.js",
  "Tarif_Biskra.txt",".htaccess","robots.txt","sitemap.xml"
)
foreach ($f in $rootFiles) {
  $src = Join-Path $root $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $outDir $f) -Force }
}

# Ensure stabilized JS remain authoritative
Copy-Item (Join-Path $stab "packs-client.js") (Join-Path $outDir "packs-client.js") -Force
Copy-Item (Join-Path $stab "script.js") (Join-Path $outDir "script.js") -Force

# API extras
$apiOut = Join-Path $outDir "api"
New-Item -ItemType Directory -Path $apiOut -Force | Out-Null
foreach ($f in @("codflow.php",".htaccess")) {
  $src = Join-Path $root "api\$f"
  if (Test-Path $src) { Copy-Item $src (Join-Path $apiOut $f) -Force }
}
# Re-copy stabilized API files over any older copies
Copy-Item (Join-Path $stab "api\*") $apiOut -Force

# Data: keep stabilized catalog/communes/tariffs; seed clean inventory
$dataOut = Join-Path $outDir "data"
New-Item -ItemType Directory -Path $dataOut -Force | Out-Null
Copy-Item (Join-Path $stab "data\*") $dataOut -Force
$dataHt = Join-Path $root "data\.htaccess"
if (Test-Path $dataHt) { Copy-Item $dataHt (Join-Path $dataOut ".htaccess") -Force }

$cleanInv = @{
  version = 2
  lastUpdated = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  inventory = @{
    "ORVA-P1-PRO" = @{ sku="ORVA-P1-PRO"; available=45; reserved=0; totalPhysical=45; lowStockThreshold=5 }
    "ORVA-P2-ELITE" = @{ sku="ORVA-P2-ELITE"; available=22; reserved=0; totalPhysical=22; lowStockThreshold=5 }
    "ORVA-P3-ULTRA" = @{ sku="ORVA-P3-ULTRA"; available=15; reserved=0; totalPhysical=15; lowStockThreshold=5 }
    "ORVA-SAC-BUNDLE" = @{ sku="ORVA-SAC-BUNDLE"; available=18; reserved=0; totalPhysical=18; lowStockThreshold=5 }
    "ORVA-DRILL-PRO" = @{ sku="ORVA-DRILL-PRO"; available=25; reserved=0; totalPhysical=25; lowStockThreshold=5 }
  }
  reservations = @{}
}
$cleanInv | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dataOut "inventory-state.json") -Encoding UTF8

# Assets
foreach ($d in @("admin","products","pack 1 4950","pack2 12950","images","images products","product images")) {
  $src = Join-Path $root $d
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $outDir $d) -Recurse -Force
  }
}

# Sanitize secrets / private
Get-ChildItem $outDir -Recurse -Force -File | Where-Object {
  $_.Name -match '^\.env|secret|credentials|secure-config' -or $_.FullName -match '\\data\\private\\'
} | Remove-Item -Force -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $outDir "data\private")) { Remove-Item (Join-Path $outDir "data\private") -Recurse -Force -ErrorAction SilentlyContinue }
Get-ChildItem $outDir -Filter ".git*" -Recurse -Force -File -ErrorAction SilentlyContinue | Remove-Item -Force

# Remove STAGING_PACKAGE_EXCLUSIONS from web root noise (optional keep)
Remove-Item (Join-Path $outDir "STAGING_PACKAGE_EXCLUSIONS.txt") -Force -ErrorAction SilentlyContinue

$files = Get-ChildItem $outDir -Recurse -File
Write-Host ("Prepared {0} files" -f $files.Count)
Push-Location $outDir
if (Test-Path $zipFile) { Remove-Item $zipFile -Force }
tar -a -c -f $zipFile *
Pop-Location
$hash = (Get-FileHash -Algorithm SHA256 $zipFile).Hash
Write-Host ("ZIP=" + $zipFile)
Write-Host ("SHA256=" + $hash)
Write-Host ("BYTES=" + (Get-Item $zipFile).Length)
