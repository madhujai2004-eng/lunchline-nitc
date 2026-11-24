param()
$ErrorActionPreference = 'Stop'
$toolchainRoot = Join-Path $PSScriptRoot 'toolchain'
$downloads = Join-Path $toolchainRoot 'downloads'
New-Item -ItemType Directory -Force -Path $downloads | Out-Null

function Get-VerifiedArchive([string]$Name, [string]$Url, [string]$Algorithm, [string]$Checksum, [string]$Destination) {
    $archive = Join-Path $downloads $Name
    if (!(Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri $Url -OutFile $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm $Algorithm).Hash -ne $Checksum) {
        throw "Checksum mismatch: $Name"
    }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolchainRoot $Destination) -Force
}

# Official vendor archives. Extracted locally; no machine-wide installation.
Get-VerifiedArchive 'jdk.zip' 'https://aka.ms/download-jdk/microsoft-jdk-17.0.21.1-windows-x64.zip' 'SHA256' 'A07E270F86AEC056D9C2ACF981EB64A38E30814DACFADBC5F80F31C55D5A4427' 'jdk'
Get-VerifiedArchive 'build-tools.zip' 'https://dl.google.com/android/repository/build-tools_r35_windows.zip' 'SHA1' 'AF059BB67CF7786F45EE0DB85E2D24985DF1B4B6' 'android/build-tools'
Get-VerifiedArchive 'platform.zip' 'https://dl.google.com/android/repository/platform-35_r02.zip' 'SHA1' '0BB560A90A7A2CBD0DD8348224D518B638FE7949' 'android/platforms'
Write-Output 'Official JDK 17.0.21.1 and Android SDK API 35 tools are ready in ./toolchain.'
