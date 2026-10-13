param([switch]$SkipBuild, [switch]$NoLaunch)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceExe = Join-Path $projectRoot 'src-tauri\target\release\aure.exe'
$buildReceipt = "$sourceExe.build.json"
$config = Get-Content (Join-Path $projectRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
if ($config.identifier -ne 'local.jingji.desktop') { throw '拒绝将隔离测试版安装到正式 aure。' }
$runtime = & (Join-Path $PSScriptRoot 'check-webview2.ps1')

function Get-ContentHash([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Get-BuildFingerprint {
    & (Join-Path $PSScriptRoot 'build-fingerprint.ps1') -ProjectRoot $projectRoot
}

$fingerprint = Get-BuildFingerprint

if (-not $SkipBuild) {
    Push-Location -LiteralPath $projectRoot
    $previousTarget = $env:CARGO_TARGET_DIR
    $previousConfig = $env:TAURI_CONFIG
    try {
        # Test builds may override the target and application identifier. A local
        # update always builds the project's production config into this exact target.
        $env:CARGO_TARGET_DIR = Join-Path $projectRoot 'src-tauri\target'
        Remove-Item Env:TAURI_CONFIG -ErrorAction SilentlyContinue
        & npm.cmd run tauri -- build --no-bundle
        if ($LASTEXITCODE -ne 0) { throw 'aure 构建失败，未更新本地应用。' }
        if ((Get-BuildFingerprint) -ne $fingerprint) { throw '构建期间源码发生变化，未安装；请重新运行更新。' }
        $entry = [regex]::Match((Get-Content (Join-Path $projectRoot 'dist/index.html') -Raw), 'src="(/assets/[^" ]+\.js)"').Groups[1].Value
        if (-not $entry) { throw '发布入口缺失，未更新本地应用。' }
        $receipt = [pscustomobject]@{
            Identifier = $config.identifier
            SourceFingerprint = $fingerprint
            ExecutableHash = Get-ContentHash $sourceExe
            FrontendEntry = $entry
            BuiltAt = [DateTime]::UtcNow.ToString('o')
        }
        $receipt | ConvertTo-Json | Set-Content -LiteralPath $buildReceipt -Encoding UTF8
    } finally {
        $env:CARGO_TARGET_DIR = $previousTarget
        $env:TAURI_CONFIG = $previousConfig
        Pop-Location
    }
} else {
    if (-not (Test-Path -LiteralPath $buildReceipt)) { throw '发布构建没有可核对的记录，请运行完整更新。' }
    $receipt = Get-Content -LiteralPath $buildReceipt -Raw | ConvertFrom-Json
    if ($receipt.Identifier -ne $config.identifier -or $receipt.SourceFingerprint -ne $fingerprint -or
        $receipt.ExecutableHash -ne (Get-ContentHash $sourceExe)) {
        throw '发布构建与当前源码不一致，拒绝安装旧版或测试版；请运行完整更新。'
    }
}

$sourceIcon = Join-Path $projectRoot 'src-tauri\icons\icon.ico'
& node (Join-Path $PSScriptRoot 'check-performance.mjs')
if ($LASTEXITCODE -ne 0) { throw '首屏脚本超出预算，未更新本地应用。' }
& node (Join-Path $PSScriptRoot 'check-size.mjs') --desktop
if ($LASTEXITCODE -ne 0) { throw '发布体积超出预算，未更新本地应用。' }
if (-not (Test-Path -LiteralPath $sourceExe)) { throw "找不到发布构建：$sourceExe" }
if (-not (Test-Path -LiteralPath $sourceIcon)) { throw "找不到图标：$sourceIcon" }

$installRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\aure'
$installedExe = Join-Path $installRoot 'aure.exe'
$installedIcon = Join-Path $installRoot 'aure.ico'
$running = Get-Process -Name aure -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedExe }
foreach ($process in $running) {
    if (-not $process.CloseMainWindow() -or -not $process.WaitForExit(10000)) {
        throw 'aure 未正常退出，未替换安装文件；请保存草稿并关闭程序后重新运行更新。'
    }
}

. (Join-Path $PSScriptRoot 'install-transaction.ps1')
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'aure.lnk'
$finalizeShortcut = {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $installedExe
    $shortcut.WorkingDirectory = $installRoot
    $shortcut.IconLocation = "$installedIcon,0"
    $shortcut.Description = 'aure · 本地写真收藏与浏览'
    $shortcut.WindowStyle = 1
    $shortcut.Save()
}
$installation = Invoke-InstallTransaction -SourceExe $sourceExe -SourceReceipt $buildReceipt -SourceIcon $sourceIcon -InstallRoot $installRoot -ShortcutPath $shortcutPath -ExpectedHash $receipt.ExecutableHash -FinalizeShortcut $finalizeShortcut
$backupExe = $installation.BackupExe

# Prune only after the replacement, receipt and shortcut are successfully saved.
# Retain the immediate rollback even if it came from an older build timestamp.
$backupCleanup = & (Join-Path $PSScriptRoot 'prune-install-backups.ps1') -InstallRoot $installRoot -Keep 2 -PreservePath $backupExe

if (-not $NoLaunch) { Start-Process -FilePath $installedExe -WindowStyle Hidden }
[pscustomobject]@{ Application = $installedExe; Shortcut = $shortcutPath; Icon = $installedIcon; Hash = $receipt.ExecutableHash; FrontendEntry = $receipt.FrontendEntry; WebView2 = $runtime.Version; Launched = -not $NoLaunch; RetainedBackups = $backupCleanup.RetainedBackups }
