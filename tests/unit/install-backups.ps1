$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('aure-backup-test-' + [Guid]::NewGuid().ToString('N'))
$cleanupScript = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts\prune-install-backups.ps1'
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    Set-Content -LiteralPath (Join-Path $testRoot 'aure.exe') -Value 'installed'
    $paths = @(1..5 | ForEach-Object {
        $file = Join-Path $testRoot ('aure.exe.backup-' + $_.ToString('x32'))
        Set-Content -LiteralPath $file -Value ('old-' + $_)
        Set-Content -LiteralPath "$file.metadata.json" -Value ('old-metadata-' + $_)
        (Get-Item -LiteralPath $file).LastWriteTimeUtc = [DateTime]::UtcNow.AddDays($_ - 6)
        $file
    })
    $unrelated = Join-Path $testRoot 'aure.exe.backup-user-copy'
    Set-Content -LiteralPath $unrelated -Value 'keep'
    $legacy = Join-Path $testRoot 'aure.exe.backup-20261001-100000'
    Set-Content -LiteralPath $legacy -Value 'legacy'
    (Get-Item -LiteralPath $legacy).LastWriteTimeUtc = [DateTime]::UtcNow.AddDays(-10)
    $nested = Join-Path $testRoot 'nested'
    New-Item -ItemType Directory -Path $nested | Out-Null
    Copy-Item -LiteralPath $paths[1] -Destination $nested
    $result = & $cleanupScript -InstallRoot $testRoot -PreservePath $paths[0]
    if ($result.RetainedBackups -ne 2 -or $result.RemovedBytes -le 0) { throw 'Incorrect retention result' }
    foreach ($path in @($paths[0], "$($paths[0]).metadata.json", $paths[4], "$($paths[4]).metadata.json", $unrelated, (Join-Path $nested (Split-Path -Leaf $paths[1])))) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Protected file removed: $path" }
    }
    foreach ($path in $paths[1..3]) { if (Test-Path -LiteralPath $path) { throw "Stale backup retained: $path" } }
    foreach ($path in $paths[1..3]) { if (Test-Path -LiteralPath "$path.metadata.json") { throw "Stale backup metadata retained: $path" } }
    if (Test-Path -LiteralPath $legacy) { throw 'Legacy timestamp backup must also rotate' }
    $again = & $cleanupScript -InstallRoot $testRoot
    if ($again.RemovedBytes -ne 0) { throw 'Cleanup must be idempotent' }
    $rejected = $false
    try { & $cleanupScript -InstallRoot $testRoot -PreservePath (Join-Path $testRoot 'aure.exe') | Out-Null }
    catch { $rejected = $true }
    if (-not $rejected -or -not (Test-Path -LiteralPath $paths[0])) { throw 'Invalid preservation must fail before deletion' }
    $fresh = Join-Path $testRoot 'fresh'
    New-Item -ItemType Directory -Path $fresh | Out-Null
    Set-Content -LiteralPath (Join-Path $fresh 'aure.exe') -Value 'installed'
    $empty = & $cleanupScript -InstallRoot $fresh
    if ($empty.RetainedBackups -ne 0 -or $empty.RemovedBytes -ne 0) { throw 'Fresh installation must succeed without backups' }
    Write-Output 'PASS: two rollbacks, immediate predecessor, unrelated/nested files, idempotence, invalid-path rejection'
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedTestRoot.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedTestRoot) -notmatch '^aure-backup-test-[a-f0-9]{32}$') { throw 'Unsafe test cleanup path' }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse
}
