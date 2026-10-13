# Atomic local program replacement and recoverable executable/metadata pairs.
# Dot-source this file; it does not build, launch, or touch a catalog.
function Get-InstallFileHash([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Get-InstallSnapshot([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $file = Get-Item -LiteralPath $Path
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Installation metadata must be a regular file: $Path"
    }
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($Path))
}

function Get-InstallSnapshotHash($Snapshot) {
    if ($null -eq $Snapshot) { return $null }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($sha.ComputeHash([Convert]::FromBase64String([string]$Snapshot)))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Set-InstallSnapshot([string]$Path, $Snapshot) {
    if ($null -eq $Snapshot) {
        if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
        return
    }
    $bytes = [Convert]::FromBase64String([string]$Snapshot)
    $pending = "$Path.pending-$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllBytes($pending, $bytes)
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($pending, $Path, [Management.Automation.Language.NullString]::Value) }
        else { Move-Item -LiteralPath $pending -Destination $Path }
    } finally { if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force } }
}

function Restore-InstallBackup {
    param([string]$BackupExe, [string]$InstallRoot, [string]$ShortcutPath)
    $root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    $backup = [IO.Path]::GetFullPath($BackupExe)
    if ([IO.Path]::GetDirectoryName($backup) -ne $root -or
        (Split-Path -Leaf $backup) -notmatch '^aure\.exe\.backup-[a-f0-9]{32}$') {
        throw 'Rollback backup must be a recognized direct child of the installation directory.'
    }
    $metadata = Get-Content -LiteralPath "$backup.metadata.json" -Raw | ConvertFrom-Json
    if ($metadata.Version -ne 1 -or (Get-InstallFileHash $backup) -ne $metadata.ExecutableHash) {
        throw 'Rollback executable/metadata hash mismatch; installation unchanged.'
    }
    foreach ($name in @('Receipt', 'Icon', 'Shortcut')) {
        if ($metadata.PSObject.Properties.Name -notcontains ($name + 'Hash') -or
            (Get-InstallSnapshotHash $metadata.$name) -ne $metadata.($name + 'Hash')) {
            throw "Rollback metadata hash mismatch: $name; installation unchanged."
        }
    }
    if ($metadata.Receipt) {
        $receipt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($metadata.Receipt)).TrimStart([char]0xfeff) | ConvertFrom-Json
        if ($receipt.ExecutableHash -ne $metadata.ExecutableHash) { throw 'Rollback receipt does not match its executable.' }
    }
    $installed = Join-Path $root 'aure.exe'
    $pending = Join-Path $root ('aure.rollback-' + [Guid]::NewGuid().ToString('N') + '.exe')
    try {
        Copy-Item -LiteralPath $backup -Destination $pending
        if ((Get-InstallFileHash $pending) -ne $metadata.ExecutableHash) { throw 'Rollback copy hash mismatch.' }
        if (Test-Path -LiteralPath $installed) { [IO.File]::Replace($pending, $installed, [Management.Automation.Language.NullString]::Value) }
        else { Move-Item -LiteralPath $pending -Destination $installed }
        Set-InstallSnapshot (Join-Path $root 'build.json') $metadata.Receipt
        Set-InstallSnapshot (Join-Path $root 'aure.ico') $metadata.Icon
        Set-InstallSnapshot $ShortcutPath $metadata.Shortcut
    } finally { if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force } }
}

function Invoke-InstallTransaction {
    param(
        [string]$SourceExe, [string]$SourceReceipt, [string]$SourceIcon,
        [string]$InstallRoot, [string]$ShortcutPath, [string]$ExpectedHash,
        [scriptblock]$FinalizeShortcut,
        [scriptblock]$WriteMetadata = { param($Source, $Destination) Set-InstallSnapshot $Destination (Get-InstallSnapshot $Source) }
    )
    $root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $directory = Get-Item -LiteralPath $root
    if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation directory must not be a reparse point.' }
    $installed = Join-Path $root 'aure.exe'
    $receiptPath = Join-Path $root 'build.json'
    $iconPath = Join-Path $root 'aure.ico'
    $previous = [pscustomobject]@{
        Version = 1
        ExecutableHash = if (Test-Path -LiteralPath $installed) { Get-InstallFileHash $installed } else { $null }
        Receipt = Get-InstallSnapshot $receiptPath
        Icon = Get-InstallSnapshot $iconPath
        Shortcut = Get-InstallSnapshot $ShortcutPath
    }
    foreach ($name in @('Receipt', 'Icon', 'Shortcut')) {
        $previous | Add-Member -NotePropertyName ($name + 'Hash') -NotePropertyValue (Get-InstallSnapshotHash $previous.$name)
    }
    $pending = Join-Path $root ('aure.pending-' + [Guid]::NewGuid().ToString('N') + '.exe')
    $backup = $null
    $replaced = $false
    try {
        Copy-Item -LiteralPath $SourceExe -Destination $pending
        if ((Get-InstallFileHash $pending) -ne $ExpectedHash) {
            throw 'Staged executable hash mismatch; installation unchanged.'
        }
        $sourceBuild = Get-Content -LiteralPath $SourceReceipt -Raw | ConvertFrom-Json
        if ($sourceBuild.ExecutableHash -ne $ExpectedHash) { throw 'Staged receipt does not match the executable.' }
        if ($previous.ExecutableHash) {
            $backup = "$installed.backup-$([Guid]::NewGuid().ToString('N'))"
            $previous | ConvertTo-Json | Set-Content -LiteralPath "$backup.metadata.json" -Encoding UTF8
            [IO.File]::Replace($pending, $installed, $backup)
        } else { Move-Item -LiteralPath $pending -Destination $installed }
        $replaced = $true
        & $WriteMetadata $SourceReceipt $receiptPath
        & $WriteMetadata $SourceIcon $iconPath
        if ($FinalizeShortcut) { & $FinalizeShortcut }
        if ((Get-InstallFileHash $installed) -ne $ExpectedHash -or
            (Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json).ExecutableHash -ne $ExpectedHash) {
            throw 'Installed executable/receipt verification failed.'
        }
        [pscustomobject]@{ BackupExe = $backup; BackupMetadata = if ($backup) { "$backup.metadata.json" } else { $null } }
    } catch {
        $failure = $_.Exception.Message
        try {
            if ($replaced) {
                if ($backup) { Restore-InstallBackup -BackupExe $backup -InstallRoot $root -ShortcutPath $ShortcutPath }
                else {
                    Remove-Item -LiteralPath $installed -Force
                    Set-InstallSnapshot $receiptPath $previous.Receipt
                    Set-InstallSnapshot $iconPath $previous.Icon
                    Set-InstallSnapshot $ShortcutPath $previous.Shortcut
                }
            } elseif ($backup -and -not (Test-Path -LiteralPath $backup)) {
                Remove-Item -LiteralPath "$backup.metadata.json" -Force -ErrorAction SilentlyContinue
            }
        } catch { throw "Local update failed: $failure. Rollback also failed: $($_.Exception.Message). Recoverable backup: $backup" }
        throw "Local update failed and the previous installation was restored: $failure"
    } finally { if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force } }
}
