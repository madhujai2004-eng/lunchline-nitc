# LunchLine Android pilot

An installable native Android entry point for the hosted LunchLine campus pilot:

https://lunchline-campus-pilot.scentedtapir5.chatgpt.site/

The launcher opens a browser Custom Tab, or the device's normal browser when Custom Tabs are unsupported. This uses the browser's authentication and cookies. It contains no WebView, login form, embedded credentials, local menu database, or offline ordering. An internet connection and an enabled browser are required. The live service remains a private campus pilot with test payments; access depends on the site's current authentication and account approval settings. Adding Google sign-in to the website is a separate service configuration and is not enabled by this APK.

## Install the APK

Copy `LunchLine.apk` to an Android device running Android 6.0 or newer. Open it, allow installation from that file source if Android prompts, and install. Launch LunchLine and tap **Open LunchLine**. Authentication and the app's full campus workflows then run on the existing live website.

This delivered pilot APK is signed with a local **test certificate**, not a production Play Store identity. It is a universal APK with no CPU-specific native libraries. It requests only `ACCESS_NETWORK_STATE`, for the launcher connection message. It does not request camera, contacts, location, storage or notification access.

## Build on Windows

Requires PowerShell and about 1 GB for a local JDK, Android SDK and downloaded archives. From this folder:

```powershell
./setup-toolchain.ps1
./build.ps1
```

The setup script downloads pinned official Microsoft OpenJDK 17.0.21.1 and Google Android Platform 35 revision 2 / Build Tools 35.0.0, checks the vendor archive hashes, and extracts them inside `toolchain/`. It makes no machine-wide configuration changes. Review the vendors' bundled license notices and the [Android SDK terms](https://developer.android.com/studio/terms) when setting up a new environment.

The build uses AAPT2, javac, D8, zipalign and apksigner directly, with no Gradle, Maven or third-party library dependency. Output is `dist/LunchLine.apk`. Set `-OutputApk` to choose another destination. Paths to an existing toolchain can be passed through `-JdkRoot`, `-BuildTools` and `-AndroidJar`.

The default build creates a fresh test certificate, signs the APK, verifies its signatures and alignment, and deletes the temporary private key. Each default rebuild has a new signing identity, so uninstall a previous test build before installing a rebuild. For updates under a stable identity, supply `-SigningKeystore` and `-SigningAlias`, and set `LUNCHLINE_KEYSTORE_PASSWORD` / `LUNCHLINE_KEY_PASSWORD` in the current process environment. Keep production signing material outside source control and this source archive.

Package: `in.lunchline.campus` · version: `1.0.0-pilot` (1) · min API: 23 · target/compile API: 35.

## Verification

The build fails on tool errors and records `apksigner verify --verbose --print-certs` plus `aapt2 dump badging` reports under `build/run-.../`. It also verifies zip alignment and prints the signed APK's SHA-256. The delivered binary has been compiled and verified with these tools. Device installation, Android screen rendering, browser selection, and end-to-end authentication still require testing on an Android device; no connected device or Android emulator was available in this build environment.

## Source map

- `src/in/lunchline/campus/MainActivity.java`: native launcher, connection status and browser launch.
- `AndroidManifest.xml`: launcher activity, package identity, SDK compatibility and permission.
- `res/`: app name, native theme and vector icon.
- `build.ps1` / `setup-toolchain.ps1`: repeatable compilation and local tool setup.
- `VERIFICATION.md`: the delivered pilot APK's hash, certificate and checks.
- `package-source.ps1`: creates a source-only archive, excluding toolchains, builds and signing material.

Android Custom Tabs intent contract: https://developer.android.com/reference/androidx/browser/customtabs/CustomTabsIntent

Official command-line signing reference: https://developer.android.com/build/building-cmdline

The hosted LunchLine server, application source and database are separate from this Android launcher and remain hosted in their existing environment.
