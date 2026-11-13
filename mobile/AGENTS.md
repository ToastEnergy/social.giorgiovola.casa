This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

The parent folder (`../`) contains the web version of the app, which also hosts the API (`/api/v1/...`). The web app and its API are the source of truth: the mobile app is a client of that API, so check the parent project for endpoints, request/response shapes, and behavior before changing or assuming anything here (see `../README.md` and `../docs/`).

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

This project uses bun (`bun.lock`). Use `bun` and `bunx`, never `npm`, `npx`, `yarn` or `pnpm`.

```bash
bun install                  # install dependencies
bunx expo install <package>  # ALWAYS use instead of bun add — resolves SDK-compatible versions
bunx expo start              # start the dev server
bunx expo lint               # lint
bunx tsc --noEmit            # typecheck
bunx expo-doctor             # diagnose dependency and config issues
bunx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

Before committing, run `bun format` and then `bun lint` **from the parent folder** (`cd ..`), not from `mobile/`. Fix whatever they report.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building

The app is not built with EAS (there is no `eas.json`), and isn't in the app stores: it is sideloaded. GitHub Actions builds it, by hand or on a `mobile-v*` tag (`../README.md`, "mobile app builds"):

- `../.github/workflows/mobile-ios.yml`: `expo prebuild`, then `generate-ipa.sh` makes an unsigned `.ipa` that AltStore signs on install. Run `generate-ipa.sh` on a Mac after `bunx expo prebuild --platform ios` to build one locally.
- `../.github/workflows/mobile-android.yml`: `expo prebuild`, then `./gradlew assembleRelease`, signed through `plugins/android-release-signing.js` with the keystore in the `ANDROID_KEYSTORE_*` secrets (the debug keystore without them). Its SHA-256 fingerprint must be in the server's `ANDROID_APP_FINGERPRINTS` for passkeys and app links.

Native signing and build settings go in config plugins (`plugins/`), never in hand edits to the generated `ios/` / `android/`. Don't add EAS without asking.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `bunx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
