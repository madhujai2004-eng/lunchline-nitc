# LunchLine

A campus canteen pilot with customer ordering, a vendor order desk, college identity verification, student discounts, peer delivery, and a simulated wallet.

Live pilot: [LunchLine](https://lunchline-campus-pilot.scentedtapir5.chatgpt.site/). Access depends on the live Site's sharing settings. All payments, wallet balances, courier earnings, and fines are simulated.

This repository contains the application source and database migrations. Hosting runs on Sites / Cloudflare Workers with D1. GitHub Pages cannot run the server authentication, API, or D1 database required by this app; publishing this repository does not deploy the application.

## Android pilot

Download `LunchLine.apk` from the [latest release](https://github.com/madhujai2004-eng/lunchline-nitc/releases/latest). It is a test-signed native launcher for Android 6.0 and later that opens the hosted app in a browser Custom Tab. It requires internet, an enabled browser, and access to the live private pilot. It does not provide offline ordering.

The native source, pinned toolchain setup, signing instructions, and verification details are in [android/README.md](android/README.md). No signing key is included. The binary was signature and manifest checked; it has not been installation-tested on a physical Android device or emulator.

## Local development

Use Node.js 22.13 or later and npm.

```sh
npm ci
```

Copy `.env.example` to `.dev.vars`. For the starter's local mock vendor identity, set `VENDOR_EMAIL=seedy@sites.test`. Build the app, then apply the migrations once in the order documented in [the pilot guide](docs/PILOT.md#run-locally), and start development:

```sh
npm run build
npm run dev
```

The portable development profile uses a local mock sign-in. Production authentication and database bindings require the hosting environment. Do not commit local secrets, database state, or account data.

## Tests

With Node.js 22.13 or later, run `npm test`. The suite uses Node's built-in test runner and an in-memory SQLite adapter for D1, applies the production migrations, and checks API authorization, ordering, stock and slot capacity, college verification, discounts, delivery, wallet accounting, and refunds. No live credentials or hosted database are needed.
## Pilot details

See [the pilot guide](docs/PILOT.md) for setup and migration commands, customer and vendor behavior, campus assumptions, identity and discount rules, delivery and refund handling, and image credits. Photo source links are also available at `/photo-credits`.

The checked-in `.openai/hosting.json` holds the existing Site project identifier and binding names. It contains no credential. It is retained for compatibility with the existing build configuration.
