# Delivered APK verification

Verified on 24 November 2026 with official Android Build Tools 35.0.0.

Artifact: `LunchLine.apk` (16,861 bytes)

SHA-256: `96c3e5447f312a0eaddab1364c78241db8f577ccac1ae96b5da2e69353ee7504`

`apksigner verify --verbose --print-certs LunchLine.apk` succeeded:

- v1 JAR signing: **true**
- APK Signature Scheme v2: **true**
- APK Signature Scheme v3: **true**
- One RSA 2048-bit signer
- Certificate DN: `CN=LunchLine Pilot Test, OU=Local Development, O=LunchLine`
- Certificate SHA-256: `9aa8bf936bbeb7783145cb9a9049cf91bfb93ec6466eb70f0d8a2d1eaefe1706`

v3.1, v4 and SourceStamp were not used for this distributable APK. This is a locally test-signed pilot, not a production release signing identity. The temporary private key was deleted after the build and is absent from source.

`zipalign -c -p 4 LunchLine.apk` succeeded.

`aapt2 dump badging LunchLine.apk` confirmed:

| Field | Value |
| --- | --- |
| Package | `in.lunchline.campus` |
| Label | LunchLine |
| Version code | 1 |
| Version name | `1.0.0-pilot` |
| Minimum SDK | 23 (Android 6.0) |
| Target SDK | 35 (Android 15) |
| Compile SDK | 35 |
| Launcher activity | `in.lunchline.campus.MainActivity` |
| Permission | `android.permission.ACCESS_NETWORK_STATE` |
| Native CPU libraries | None; universal APK |

The APK includes compiled `classes.dex`, its binary manifest, resource table and vector app icon. The native source received a separate compatibility review with no blocking findings.

No connected Android device or emulator was available. Device installation, screen rendering, browser selection and end-to-end sign-in have **not** been exercised on Android. The launcher opens the existing hosted private pilot in a browser Custom Tab or normal browser; it does not add an offline app, native authentication, production payments or Google OAuth configuration to the website.

The source build script intentionally creates a fresh local test signing identity by default, so a rebuild will have a different APK hash and certificate. Supply a maintained keystore for a stable update identity.
