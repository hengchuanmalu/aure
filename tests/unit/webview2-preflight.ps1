$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts\check-webview2.ps1') -FunctionsOnly
foreach ($versions in @(@(), @(''), @('0.0.0.0'), @('invalid'), @('110.0.1000.1'))) {
    $rejected = $false
    try { Resolve-WebView2Runtime -Versions $versions | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw "Invalid/missing/old Runtime accepted: $versions" }
}
$current = Resolve-WebView2Runtime -Versions @('0.0.0.0', '111.0.0.0', '154.0.4258.62')
if ($current.Version -ne '154.0.4258.62') { throw 'Available current Runtime not selected' }
$minimum = Resolve-WebView2Runtime -Versions @('111.0.0.0')
if (-not $minimum.Installed -or $minimum.MinimumMajor -ne 111) { throw 'Supported minimum rejected' }
Write-Output 'PASS: missing/invalid/zero/old Runtime rejected; current registration and minimum selected'
