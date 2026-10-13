param([switch]$FunctionsOnly)

$ErrorActionPreference = 'Stop'

function Resolve-WebView2Runtime([string[]]$Versions) {
    $available = @($Versions | ForEach-Object {
        $parsed = $null
        if ([Version]::TryParse($_, [ref]$parsed) -and $parsed -gt [Version]'0.0.0.0') { $parsed }
    } | Sort-Object -Descending)
    if ($available.Count -eq 0) {
        throw '未检测到 WebView2 Runtime，未更新 aure。请先安装 Microsoft Evergreen WebView2 Runtime：https://developer.microsoft.com/microsoft-edge/webview2/'
    }
    if ($available[0].Major -lt 111) {
        throw "WebView2 Runtime $($available[0]) 过旧，未更新 aure。前端基础样式要求 Chromium 111 及更新版本；请更新 Evergreen Runtime。"
    }
    [pscustomobject]@{ Version = $available[0].ToString(); MinimumMajor = 111; Installed = $true }
}

function Get-WebView2Runtime {
    # Microsoft's documented Evergreen pv registration, using explicit views
    # so detection does not depend on the PowerShell process architecture.
    $client = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    $versions = @()
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
            try {
                $key = $base.OpenSubKey($client, $false)
                if ($key) { try { $versions += [string]$key.GetValue('pv') } finally { $key.Dispose() } }
            } finally { $base.Dispose() }
        }
    }
    if ($env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER) {
        $executable = Join-Path $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER 'msedgewebview2.exe'
        if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw '指定的 WEBVIEW2_BROWSER_EXECUTABLE_FOLDER 不包含有效 Runtime，未更新 aure。' }
        # An explicit fixed runtime takes precedence over registered Evergreen.
        $versions = @((Get-Item -LiteralPath $executable).VersionInfo.ProductVersion)
    }
    Resolve-WebView2Runtime $versions
}

if (-not $FunctionsOnly) { Get-WebView2Runtime }
