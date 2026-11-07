# ==============================================================================
# ORVA STORE - Hostinger Deployment Packager (PowerShell)
# Website: orva-store.com | Web Server: LiteSpeed | PHP: 8.3
# ==============================================================================

$ErrorActionPreference = "Stop"

$workspaceRoot = "E:\Websites On Line\yamahasac"
$distDir = Join-Path $workspaceRoot "dist-hostinger"
$zipFile = Join-Path $workspaceRoot "orva-store-hostinger.zip"


$dashboardOut = Join-Path $workspaceRoot "orvastore Dashbaord v0.9\next-shadcn-admin-dashboard-baseui-main\out"
$adminDir = Join-Path $workspaceRoot "admin"

# 0. Sync latest Next.js dashboard build to admin/ before packaging
Write-Host "Syncing dashboard build (out/ -> admin/)..."
if (Test-Path $dashboardOut) {
    if (Test-Path $adminDir) { Remove-Item -Recurse -Force $adminDir }
    Copy-Item -Path $dashboardOut -Destination $adminDir -Recurse
    Write-Host "  OK: admin/ synced from latest build ($((Get-ChildItem -Recurse -File $adminDir).Count) files)"
} else {
    Write-Warning "  Dashboard out/ not found - run 'npm run build' in the dashboard project first. Skipping sync."
}

Write-Host "Packaging ORVA STORE for Hostinger (orva-store.com)..."

# 1. Clean previous build
if (Test-Path $distDir) {
    Remove-Item -Recurse -Force $distDir
}
if (Test-Path $zipFile) {
    Remove-Item -Force $zipFile
}

New-Item -ItemType Directory -Path $distDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $distDir "api") -Force | Out-Null

# 2. Copy Root Files
$rootFiles = @(
    "index.html",
    "pack1.html",
    "pack2.html",
    "pack3.html",
    "yamaha-archive.html",
    "styles.css",
    "packs-styles.css",
    "script.js",
    "packs-client.js",
    "packs-config.js",
    "meta-pixel-loader.js",
    "algeria-communes.js",
    "Tarif_Biskra.txt",
    ".htaccess",
    "robots.txt",
    "sitemap.xml"
)

Write-Host "Copying core frontend files..."
foreach ($f in $rootFiles) {
    $src = Join-Path $workspaceRoot $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $distDir -Force
        Write-Host "  OK: $f"
    } else {
        Write-Warning "  Missing: $f"
    }
}

# 3. Copy API Files
$apiFiles = @(
    "send-order.php",
    "config.php",
    "auth.php",
    "delivery.php",
    "publish-page.php",
    "admin-settings.php",
    "analytics.php",
    ".htaccess"
)

Write-Host "Copying PHP API files..."
foreach ($f in $apiFiles) {
    $src = Join-Path (Join-Path $workspaceRoot "api") $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $distDir "api") -Force
        Write-Host "  OK: api/$f"
    } else {
        Write-Warning "  Missing: api/$f"
    }
}

# 3.1. Copy Protected Data Files
New-Item -ItemType Directory -Path (Join-Path $distDir "data") -Force | Out-Null
$dataFiles = @(
    ".htaccess",
    "products-catalog.json",
    "wilayas-tariffs.json",
    "inventory-state.json"
)

Write-Host "Copying protected initial data files..."
foreach ($df in $dataFiles) {
    $src = Join-Path (Join-Path $workspaceRoot "data") $df
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $distDir "data") -Force
        Write-Host "  OK: data/$df"
    }
}
# 4. Copy Media & Asset Folders
$assetDirs = @(
    "admin",
    "lib",
    "products",
    "pack 1 4950",
    "pack2 12950",
    "pack3 15950",
    "images",
    "images products",
    "product images",
    "assets"
)

Write-Host "Copying product image directories..."
foreach ($d in $assetDirs) {
    $src = Join-Path $workspaceRoot $d
    if (Test-Path $src) {
        $dest = Join-Path $distDir $d
        Copy-Item -Path $src -Destination $dest -Recurse -Force
        $cnt = (Get-ChildItem -Path $dest -File -Recurse).Count
        Write-Host "  OK: $d ($cnt files)"
    } else {
        Write-Warning "  Missing dir: $d"
    }
}

# 4.1. Sanitize dist directory: strip Git tracking files & dev dotfiles
Write-Host "Sanitizing dist-hostinger (removing dotfiles and git artifacts)..."
Get-ChildItem -Path $distDir -Filter ".git*" -Recurse -Force -File -ErrorAction SilentlyContinue | Remove-Item -Force
New-Item -ItemType Directory -Path (Join-Path $distDir "products") -Force | Out-Null

# 5. Measure files
$allFiles = Get-ChildItem -Path $distDir -Recurse -File
$fileCount = $allFiles.Count
$sumBytes = ($allFiles | Measure-Object -Property Length -Sum).Sum
$totalMB = [math]::Round(($sumBytes / 1MB), 2)
Write-Host "Prepared $fileCount production files in dist-hostinger ($totalMB MB)"

# 6. Create Zip Archive
Write-Host "Compressing into orva-store-hostinger.zip..."
Push-Location $distDir
tar -a -c -f $zipFile *
Pop-Location
$zipBytes = (Get-Item $zipFile).Length
$zipMB = [math]::Round(($zipBytes / 1MB), 2)

Write-Host "Package creation complete!"
Write-Host "Target zip: $zipFile ($zipMB MB)"
