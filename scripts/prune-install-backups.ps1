param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [ValidateRange(2, 10)][int]$Keep = 2,
    [string]$PreservePath
)

$ErrorActionPreference = 'Stop'
$root = Get-Item -LiteralPath $InstallRoot
if (-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Rollback cleanup requires a regular installation directory.'
}
$resolvedRoot = $root.FullName.TrimEnd([IO.Path]::DirectorySeparatorChar)
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot 'aure.exe') -PathType Leaf)) {
    throw 'Rollback cleanup requires an installed aure.exe.'
}
$backups = @(Get-ChildItem -LiteralPath $resolvedRoot -File | Where-Object {
    $_.Name -match '^aure\.exe\.backup-(?:[a-f0-9]{32}|\d{8}-\d{6})$' -and
    -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
} | Sort-Object LastWriteTimeUtc, CreationTimeUtc, Name -Descending)
$retained = @()
if ($PreservePath) {
    $preserved = [IO.Path]::GetFullPath($PreservePath)
    if (-not ($backups | Where-Object { $_.FullName -eq $preserved })) {
        throw 'The rollback file to preserve is outside the recognized backup set.'
    }
    $retained += $preserved
}
$retained += @($backups | Where-Object { $_.FullName -notin $retained } |
    Select-Object -First ($Keep - $retained.Count) -ExpandProperty FullName)
$removedBytes = 0L
foreach ($backup in $backups) {
    if ($backup.FullName -in $retained) { continue }
    # Only direct children with the generated executable backup name are eligible.
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($backup.FullName)) -ne $resolvedRoot) {
        throw 'Rollback path escaped the installation directory.'
    }
    Remove-Item -LiteralPath $backup.FullName
    $removedBytes += $backup.Length
    $metadataPath = "$($backup.FullName).metadata.json"
    if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        $metadata = Get-Item -LiteralPath $metadataPath
        if (-not ($metadata.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Remove-Item -LiteralPath $metadataPath
            $removedBytes += $metadata.Length
        }
    }
}
[pscustomobject]@{ RetainedBackups = $retained.Count; RemovedBytes = $removedBytes }
