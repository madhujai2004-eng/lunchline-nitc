param(
    [string]$OutputApk = (Join-Path $PSScriptRoot 'dist/LunchLine.apk'),
    [string]$JdkRoot = (Join-Path $PSScriptRoot 'toolchain/jdk/jdk-17.0.21.1+2'),
    [string]$BuildTools = (Join-Path $PSScriptRoot 'toolchain/android/build-tools/android-15'),
    [string]$AndroidJar = (Join-Path $PSScriptRoot 'toolchain/android/platforms/android-35/android.jar'),
    [string]$SigningKeystore = '',
    [string]$SigningAlias = 'lunchline-pilot-test'
)
$ErrorActionPreference = 'Stop'
$taskBuild = Join-Path $PSScriptRoot ('build/run-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff'))
$classes = Join-Path $taskBuild 'classes'
$generated = Join-Path $taskBuild 'generated'
$dex = Join-Path $taskBuild 'dex'
New-Item -ItemType Directory -Force -Path $classes, $generated, $dex | Out-Null
$java = Join-Path $JdkRoot 'bin/java.exe'
$javac = Join-Path $JdkRoot 'bin/javac.exe'
$jar = Join-Path $JdkRoot 'bin/jar.exe'
$keytool = Join-Path $JdkRoot 'bin/keytool.exe'
$aapt2 = Join-Path $BuildTools 'aapt2.exe'
$zipalign = Join-Path $BuildTools 'zipalign.exe'
$apksigner = Join-Path $BuildTools 'lib/apksigner.jar'
$d8 = Join-Path $BuildTools 'lib/d8.jar'
foreach ($tool in @($java, $javac, $jar, $keytool, $aapt2, $zipalign, $apksigner, $d8, $AndroidJar)) {
    if (!(Test-Path -LiteralPath $tool)) { throw "Missing tool: $tool. Run ./setup-toolchain.ps1 first or pass toolchain paths." }
}
function Assert-ToolExit([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
}
$resources = Join-Path $taskBuild 'resources.zip'
$unsigned = Join-Path $taskBuild 'unsigned.apk'
$aligned = Join-Path $taskBuild 'aligned.apk'
& $aapt2 compile --dir (Join-Path $PSScriptRoot 'res') -o $resources
Assert-ToolExit 'Resource compilation'
& $aapt2 link -o $unsigned -I $AndroidJar --manifest (Join-Path $PSScriptRoot 'AndroidManifest.xml') --java $generated $resources
Assert-ToolExit 'Resource linking'
$sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src'), $generated -Filter '*.java' -File -Recurse | ForEach-Object { $_.FullName })
& $javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -classpath $AndroidJar -d $classes $sources
Assert-ToolExit 'Java compilation'
$classJar = Join-Path $taskBuild 'classes.jar'
& $jar cf $classJar -C $classes .
Assert-ToolExit 'Class packaging'
& $java -cp $d8 com.android.tools.r8.D8 --release --min-api 23 --lib $AndroidJar --output $dex $classJar
Assert-ToolExit 'DEX compilation'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($unsigned, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $dex 'classes.dex'), 'classes.dex', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $archive.Dispose() }
& $zipalign -f -p 4 $unsigned $aligned
Assert-ToolExit 'APK alignment'

$ephemeralSigning = [string]::IsNullOrWhiteSpace($SigningKeystore)
$previousStorePassword = $env:LUNCHLINE_KEYSTORE_PASSWORD
$previousKeyPassword = $env:LUNCHLINE_KEY_PASSWORD
try {
    if ($ephemeralSigning) {
        # Fresh local test identity. No password or signing key is shipped in source.
        $SigningKeystore = Join-Path $taskBuild 'ephemeral-test-signing.p12'
        $env:LUNCHLINE_KEYSTORE_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
        $env:LUNCHLINE_KEY_PASSWORD = $env:LUNCHLINE_KEYSTORE_PASSWORD
        & $keytool -genkeypair -noprompt -storetype PKCS12 -keystore $SigningKeystore -alias $SigningAlias -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=LunchLine Pilot Test, OU=Local Development, O=LunchLine' -storepass:env LUNCHLINE_KEYSTORE_PASSWORD -keypass:env LUNCHLINE_KEY_PASSWORD
        Assert-ToolExit 'Test certificate generation'
    } elseif ([string]::IsNullOrWhiteSpace($env:LUNCHLINE_KEYSTORE_PASSWORD)) {
        throw 'Set LUNCHLINE_KEYSTORE_PASSWORD for the supplied keystore.'
    }
    if ([string]::IsNullOrWhiteSpace($env:LUNCHLINE_KEY_PASSWORD)) { $env:LUNCHLINE_KEY_PASSWORD = $env:LUNCHLINE_KEYSTORE_PASSWORD }
    $absoluteOutput = [System.IO.Path]::GetFullPath($OutputApk)
    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($absoluteOutput)) | Out-Null
    & $java -jar $apksigner sign --ks $SigningKeystore --ks-key-alias $SigningAlias --ks-pass env:LUNCHLINE_KEYSTORE_PASSWORD --key-pass env:LUNCHLINE_KEY_PASSWORD --v4-signing-enabled false --out $absoluteOutput $aligned
    Assert-ToolExit 'APK signing'
    $signatureReport = & $java -jar $apksigner verify --verbose --print-certs $absoluteOutput
    Assert-ToolExit 'APK signature verification'
    $signatureReport | Set-Content -LiteralPath (Join-Path $taskBuild 'signature.txt') -Encoding UTF8
    $signatureReport | Write-Output
    & $zipalign -c -p 4 $absoluteOutput
    Assert-ToolExit 'Signed APK alignment verification'
    $manifestReport = & $aapt2 dump badging $absoluteOutput
    Assert-ToolExit 'Manifest verification'
    $manifestReport | Set-Content -LiteralPath (Join-Path $taskBuild 'manifest.txt') -Encoding UTF8
    $manifestReport | Write-Output
    Get-FileHash -LiteralPath $absoluteOutput -Algorithm SHA256 | Format-List
    Write-Output "APK built: $absoluteOutput"
    Write-Output "Verification reports: $taskBuild"
} finally {
    if ($ephemeralSigning -and (Test-Path -LiteralPath $SigningKeystore)) { Remove-Item -LiteralPath $SigningKeystore }
    $env:LUNCHLINE_KEYSTORE_PASSWORD = $previousStorePassword
    $env:LUNCHLINE_KEY_PASSWORD = $previousKeyPassword
}
