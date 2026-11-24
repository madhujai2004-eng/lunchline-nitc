param([string]$OutputZip = (Join-Path $PSScriptRoot 'dist/LunchLine Android Source.zip'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot) + [System.IO.Path]::DirectorySeparatorChar
$selectedFiles = @(
    '.gitignore', 'AndroidManifest.xml', 'README.md', 'VERIFICATION.md',
    'build.ps1', 'setup-toolchain.ps1', 'package-source.ps1'
) | ForEach-Object { Get-Item -LiteralPath (Join-Path $PSScriptRoot $_) }
$selectedFiles += @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src'), (Join-Path $PSScriptRoot 'res') -File -Recurse)
$absoluteZip = [System.IO.Path]::GetFullPath($OutputZip)
New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($absoluteZip)) | Out-Null
if (Test-Path -LiteralPath $absoluteZip) { Remove-Item -LiteralPath $absoluteZip }
$archive = [System.IO.Compression.ZipFile]::Open($absoluteZip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $selectedFiles) {
        $entryName = $file.FullName.Substring($sourceRoot.Length).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
Write-Output "Source archive: $absoluteZip"
Get-FileHash -LiteralPath $absoluteZip -Algorithm SHA256 | Format-List
