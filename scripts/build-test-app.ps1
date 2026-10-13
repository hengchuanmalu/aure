param(
    [string]$Identifier = 'local.jingji.user-journey-audit',
    [string]$TargetDirectory = 'src-tauri\target-release-audit',
    [switch]$FunctionsOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
function Get-TestBuildHash([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}
if ($FunctionsOnly) { return }
if ($Identifier -notmatch '^local\.(jingji|aure)\.[a-z0-9-]+$' -or $Identifier -eq 'local.jingji.desktop') {
    throw '隔离测试必须使用独立 identifier，拒绝正式图库。'
}
$target = [IO.Path]::GetFullPath((Join-Path $projectRoot $TargetDirectory))
$nativeRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'src-tauri')).TrimEnd('\') + '\'
if (-not $target.StartsWith($nativeRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $target) -notmatch '^target-[a-z0-9-]+$') {
    throw '测试构建必须位于 src-tauri\target-* 独立目录。'
}
$output = Join-Path $projectRoot 'verification\native-release'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$configPath = Join-Path $output "tauri-test-$Identifier.conf.json"
$configJSON = @{ identifier = $Identifier } | ConvertTo-Json
[IO.File]::WriteAllText($configPath, $configJSON, [Text.UTF8Encoding]::new($false))
$fingerprint = & (Join-Path $PSScriptRoot 'build-fingerprint.ps1') -ProjectRoot $projectRoot
$previousTarget = $env:CARGO_TARGET_DIR
$previousConfig = $env:TAURI_CONFIG
Push-Location -LiteralPath $projectRoot
try {
    $env:CARGO_TARGET_DIR = $target
    Remove-Item Env:TAURI_CONFIG -ErrorAction SilentlyContinue
    & npm.cmd run tauri -- build --no-bundle --config $configPath
    if ($LASTEXITCODE -ne 0) { throw '隔离 Release 构建失败。' }
    if ((& (Join-Path $PSScriptRoot 'build-fingerprint.ps1') -ProjectRoot $projectRoot) -ne $fingerprint) {
        throw '构建期间源码发生变化，拒绝生成验收收据。'
    }
    $exe = Join-Path $target 'release\aure.exe'
    $entry = [regex]::Match((Get-Content (Join-Path $projectRoot 'dist\index.html') -Raw), 'src="(/assets/[^" ]+\.js)"').Groups[1].Value
    if (-not $entry) { throw '隔离构建前端入口缺失。' }
    $receipt = [pscustomobject]@{
        Identifier = $Identifier
        SourceFingerprint = $fingerprint
        ExecutableHash = Get-TestBuildHash $exe
        FrontendEntry = $entry
        BuiltAt = [DateTime]::UtcNow.ToString('o')
    }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath "$exe.build.json" -Encoding UTF8
    Write-Output ([pscustomobject]@{ Executable = $exe; Receipt = "$exe.build.json"; Identifier = $Identifier })
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:TAURI_CONFIG = $previousConfig
    Pop-Location
}
