$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $projectRoot 'scripts\install-transaction.ps1')
. (Join-Path $projectRoot 'scripts\build-test-app.ps1') -FunctionsOnly
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('aure-install-transaction-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $source = Join-Path $testRoot 'source'
    New-Item -ItemType Directory -Path $source | Out-Null
    $sourceExe = Join-Path $source 'aure.exe'
    $sourceReceipt = Join-Path $source 'build.json'
    $sourceIcon = Join-Path $source 'aure.ico'
    Set-Content -LiteralPath $sourceExe -Value 'new executable'
    Set-Content -LiteralPath $sourceIcon -Value 'new icon'
    $newHash = Get-InstallFileHash $sourceExe
    if ((Get-TestBuildHash $sourceExe) -ne $newHash) { throw 'Build receipt and installer SHA-256 helpers disagree' }
    @{ ExecutableHash = $newHash; SourceFingerprint = 'new-source'; FrontendEntry = '/assets/new.js' } | ConvertTo-Json | Set-Content -LiteralPath $sourceReceipt

    foreach ($mode in @('success', 'receipt-failure', 'icon-failure', 'shortcut-failure', 'first-install-failure', 'hash-mismatch')) {
        $install = Join-Path $testRoot $mode
        New-Item -ItemType Directory -Path $install | Out-Null
        $shortcut = Join-Path $install 'aure.lnk'
        if ($mode -ne 'first-install-failure') {
            Set-Content -LiteralPath (Join-Path $install 'aure.exe') -Value 'previous executable'
            $oldHash = Get-InstallFileHash (Join-Path $install 'aure.exe')
            @{ ExecutableHash = $oldHash; SourceFingerprint = 'old-source'; FrontendEntry = '/assets/old.js' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $install 'build.json')
            Set-Content -LiteralPath (Join-Path $install 'aure.ico') -Value 'previous icon'
            Set-Content -LiteralPath $shortcut -Value 'previous shortcut'
        }
        $before = @{}
        foreach ($name in @('aure.exe', 'build.json', 'aure.ico', 'aure.lnk')) { $before[$name] = Get-InstallSnapshot (Join-Path $install $name) }
        $write = {
            param($from, $to)
            if (($mode -eq 'receipt-failure' -and (Split-Path -Leaf $to) -eq 'build.json') -or
                ($mode -in @('icon-failure', 'first-install-failure') -and (Split-Path -Leaf $to) -eq 'aure.ico')) {
                throw [IO.IOException]::new('Injected metadata write failure')
            }
            Set-InstallSnapshot $to (Get-InstallSnapshot $from)
        }.GetNewClosure()
        $finalize = {
            Set-Content -LiteralPath $shortcut -Value 'new shortcut'
            if ($mode -eq 'shortcut-failure') { throw [IO.IOException]::new('Injected shortcut save failure') }
        }.GetNewClosure()
        $failed = $false
        try {
            $expected = if ($mode -eq 'hash-mismatch') { 'INVALID' } else { $newHash }
            $result = Invoke-InstallTransaction -SourceExe $sourceExe -SourceReceipt $sourceReceipt -SourceIcon $sourceIcon -InstallRoot $install -ShortcutPath $shortcut -ExpectedHash $expected -WriteMetadata $write -FinalizeShortcut $finalize
        } catch { $failed = $true; $actualFailure = $_.Exception.Message }
        if ($mode -eq 'success') {
            if ($failed -or (Get-InstallFileHash (Join-Path $install 'aure.exe')) -ne $newHash) { throw "Successful installation failed: $actualFailure" }
            if (-not (Test-Path -LiteralPath $result.BackupMetadata)) { throw 'Successful backup has no recoverable metadata' }
            $backupText = Get-Content -LiteralPath $result.BackupMetadata -Raw
            $tampered = $backupText | ConvertFrom-Json
            $tampered.Icon = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('tampered icon'))
            $tampered | ConvertTo-Json | Set-Content -LiteralPath $result.BackupMetadata
            $rejected = $false
            try { Restore-InstallBackup -BackupExe $result.BackupExe -InstallRoot $install -ShortcutPath $shortcut }
            catch { $rejected = $true }
            if (-not $rejected -or (Get-InstallFileHash (Join-Path $install 'aure.exe')) -ne $newHash) {
                throw 'Corrupted backup metadata modified the installed executable'
            }
            Set-Content -LiteralPath $result.BackupMetadata -Value $backupText
            Restore-InstallBackup -BackupExe $result.BackupExe -InstallRoot $install -ShortcutPath $shortcut
        } elseif (-not $failed) { throw "Expected failure was accepted: $mode" }
        foreach ($name in $before.Keys) {
            if ((Get-InstallSnapshot (Join-Path $install $name)) -ne $before[$name]) { throw "Installation changed after rollback: $mode $name" }
        }
        if (@(Get-ChildItem -LiteralPath $install -Filter '*.pending-*').Count -ne 0) { throw 'Staging files leaked' }
    }
    Write-Output 'PASS: successful update and verifiable EXE/receipt/icon/shortcut restore; receipt/icon/shortcut failure rollback; first-install cleanup; staged hash rejection'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolved) -notmatch '^aure-install-transaction-[a-f0-9]{32}$') { throw 'Unsafe test cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse
}
