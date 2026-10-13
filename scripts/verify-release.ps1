param([switch]$SkipBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$output = Join-Path $projectRoot 'verification\release'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$results = @()
$server = $null
$failure = $null
$previousBaseUrl = $env:AURE_BROWSER_BASE_URL
$previousHtmlOutput = $env:PLAYWRIGHT_HTML_OUTPUT_DIR
Push-Location -LiteralPath $projectRoot

function Invoke-Gate([string]$Name, [scriptblock]$Command) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Write-Output "Release gate: $Name"
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
    $script:results += [pscustomobject]@{ Name = $Name; Passed = $true; DurationMs = $timer.ElapsedMilliseconds }
}

try {
    $fingerprint = & (Join-Path $PSScriptRoot 'build-fingerprint.ps1') -ProjectRoot $projectRoot
    Invoke-Gate 'frontend-build-and-unit' { & npm.cmd run verify }
    Invoke-Gate 'public-assets-and-licenses' { & npm.cmd run check:open-source }
    Invoke-Gate 'npm-security' { & npm.cmd audit --audit-level=high }
    Invoke-Gate 'rust-tests' { & cargo test --locked --manifest-path src-tauri/Cargo.toml }
    Invoke-Gate 'rust-security' {
        & cargo audit --json --file src-tauri/Cargo.lock | Set-Content -LiteralPath (Join-Path $output 'rustsec.json') -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { throw 'RustSec audit failed; inspect verification/release/rustsec.json.' }
        $audit = Get-Content -LiteralPath (Join-Path $output 'rustsec.json') -Raw | ConvertFrom-Json
        if ($audit.vulnerabilities.found) { throw 'RustSec reported vulnerable dependencies.' }
        if ($audit.warnings) { Write-Warning 'Review RustSec informational/yanked warnings for the actual Windows dependency tree; preserve the report.' }
    }
    Invoke-Gate 'install-backup-retention' { & npm.cmd run test:install-backups }
    Invoke-Gate 'install-failure-rollback' { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/unit/install-transaction.ps1 }
    Invoke-Gate 'webview2-preflight-policy' { & npm.cmd run test:webview2-preflight }
    Invoke-Gate 'native-script-syntax' {
        foreach ($file in Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tests\native') -Filter '*.mjs' -File) {
            & node --check $file.FullName
            if ($LASTEXITCODE -ne 0) { throw "Invalid native script: $($file.Name)" }
        }
    }
    if (-not $SkipBrowser) {
        # A dedicated production preview avoids depending on a stale dev server.
        $server = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'scripts/preview-browser-tests.mjs' -WindowStyle Hidden -PassThru
        $ready = $false
        $entry = [regex]::Match((Get-Content 'dist/index.html' -Raw), 'src="(/assets/[^" ]+\.js)"').Groups[1].Value
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if ($server.HasExited) { throw 'Production preview did not start; ensure port 1421 is free.' }
            try {
                $response = Invoke-WebRequest 'http://127.0.0.1:1421' -UseBasicParsing -TimeoutSec 2
                if ($response.StatusCode -eq 200 -and $response.Content.Contains($entry)) { $ready = $true; break }
            } catch { }
            Start-Sleep -Seconds 1
        }
        if (-not $ready -or -not $entry) { throw 'Current production browser entry unavailable.' }
        $env:AURE_BROWSER_BASE_URL = 'http://127.0.0.1:1421'
        $env:PLAYWRIGHT_HTML_OUTPUT_DIR = Join-Path $output 'browser-report'
        Invoke-Gate 'production-browser' { & npm.cmd run test:e2e -- --output verification/release/browser-results }
    }
    if ((& (Join-Path $PSScriptRoot 'build-fingerprint.ps1') -ProjectRoot $projectRoot) -ne $fingerprint) {
        throw 'Source changed during release verification; rebuild and verify the final candidate.'
    }
} catch { $failure = $_.Exception.Message }
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
    $env:AURE_BROWSER_BASE_URL = $previousBaseUrl
    $env:PLAYWRIGHT_HTML_OUTPUT_DIR = $previousHtmlOutput
    $report = [pscustomobject]@{
        CompletedAt = [DateTime]::UtcNow.ToString('o')
        SourceFingerprint = $fingerprint
        Passed = ($null -eq $failure)
        BrowserSkipped = [bool]$SkipBrowser
        Failure = $failure
        Checks = $results
        Pending = @('isolated Release WebView2 gate',
            'installed read-only WebView2 gate', 'clean Windows and offline/missing-runtime installation',
            'OS picker, real DPI, storage/permission faults, low-memory endurance')
    }
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'gate.json') -Encoding UTF8
    Pop-Location
}
if ($failure) { throw $failure }
