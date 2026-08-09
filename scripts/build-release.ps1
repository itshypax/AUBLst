param(
    [string]$PhpPath = '',
    [switch]$RequirePhp
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$frontendRoot = Join-Path $projectRoot 'frontend'
$releaseRoot = Join-Path $projectRoot '.release'

function Invoke-Step([string]$Label, [scriptblock]$Command) {
    Write-Host "`n$Label" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label ist fehlgeschlagen." }
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (!$npmCommand) { $npmCommand = Get-Command npm -ErrorAction Stop }
$npm = $npmCommand.Source

Invoke-Step 'Frontend-Tests' { & $npm --prefix $frontendRoot test }
Invoke-Step 'Frontend-Pruefung' { & $npm --prefix $frontendRoot run check }
Invoke-Step 'Frontend-Build' { & $npm --prefix $frontendRoot run build }

$php = $PhpPath
if (!$php) {
    $phpCommand = Get-Command php -ErrorAction SilentlyContinue
    if ($phpCommand) { $php = $phpCommand.Source }
}
if ($php) {
    Invoke-Step 'Backend-Tests' { & $php (Join-Path $projectRoot 'backend/tests/run.php') }
} elseif ($RequirePhp) {
    throw 'PHP wurde nicht gefunden. Mit -PhpPath kann die PHP-CLI von Plesk oder XAMPP angegeben werden.'
} else {
    Write-Warning 'PHP wurde nicht gefunden; die Backend-Tests wurden uebersprungen. Mit -RequirePhp wird daraus ein Abbruch.'
}

$commit = (& git -c "safe.directory=$($projectRoot.Replace('\', '/'))" -C $projectRoot rev-parse --short=8 HEAD 2>$null)
if (!$commit) { $commit = 'unbekannt' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$packageName = "aublst-$commit-$stamp"
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $packageName))
$releasePrefix = [System.IO.Path]::GetFullPath($releaseRoot).TrimEnd('\') + '\'
if (!$packageRoot.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Das berechnete Release-Ziel liegt ausserhalb des Release-Ordners.'
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
if (Test-Path -LiteralPath $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot 'backend') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot 'frontend') | Out-Null

Copy-Item -Path (Join-Path $projectRoot 'backend/*') -Destination (Join-Path $packageRoot 'backend') -Recurse -Force
$localConfig = Join-Path $packageRoot 'backend/config.local.php'
if (Test-Path -LiteralPath $localConfig) { Remove-Item -LiteralPath $localConfig -Force }
$backendTests = Join-Path $packageRoot 'backend/tests'
if (Test-Path -LiteralPath $backendTests) { Remove-Item -LiteralPath $backendTests -Recurse -Force }
Copy-Item -Path (Join-Path $frontendRoot 'dist/*') -Destination (Join-Path $packageRoot 'frontend') -Recurse -Force

$zipPath = "$packageRoot.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -LiteralPath $packageRoot -Recurse -File | ForEach-Object {
        $entryName = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip,
            $_.FullName,
            $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $zip.Dispose()
}

Write-Host "`nRelease erstellt:" -ForegroundColor Green
Write-Host $zipPath
Write-Host 'Der Inhalt passt direkt in aublst.hypax.wtf/backend und aublst.hypax.wtf/frontend.'
