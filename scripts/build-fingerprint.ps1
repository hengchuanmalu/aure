param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
function Get-ContentHash([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

# Installation and native acceptance must use exactly the same build inputs.
$directories = @('src', 'public', 'src-tauri/src', 'src-tauri/icons', 'src-tauri/capabilities', 'design/tokens')
$files = @('package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'scripts/check-boundaries.mjs', 'scripts/check-performance.mjs', 'scripts/check-size.mjs', 'scripts/build-fingerprint.ps1', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json', 'src-tauri/build.rs')
$inputs = @(
    foreach ($directory in $directories) { Get-ChildItem -LiteralPath (Join-Path $ProjectRoot $directory) -File -Recurse }
    foreach ($file in $files) { Get-Item -LiteralPath (Join-Path $ProjectRoot $file) }
) | Sort-Object FullName
$lines = foreach ($inputFile in $inputs) {
    $relative = $inputFile.FullName.Substring($ProjectRoot.Length)
    "$relative $(Get-ContentHash $inputFile.FullName)"
}
$sha = [Security.Cryptography.SHA256]::Create()
try { ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))))).Replace('-', '') }
finally { $sha.Dispose() }
