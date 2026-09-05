# Mobile App (`@site-macaron/mobile`)

React Native + Expo (SDK 51) + TypeScript app for the AI Construction Compliance
Platform. Cross-platform: **Android today, iPhone next** — same codebase, no
platform-specific screens.

## What it does

Two audiences, one app:

- **Admins / supervisors** sign in with Cognito (same User Pool as the web
  portal) and see their assigned sites. They can scan a worker's site QR to run
  an on-the-spot access decision.
- **Workers** don't sign in. They scan the site QR (or open an SMS magic link),
  confirm their identity (full legal name + last 4 phone digits), and get an
  `allowed` / `conditional` / `denied` decision — reusing the backend's
  worker-scoped public surface (`/public/check-in/{token}`), which never leaks
  rule/evidence/policy details.

## Architecture

```
app/                       # Expo Router file-based routes
  _layout.tsx              # providers, polyfills, auth hydration, Stack
  index.tsx                # gate → routes by auth state
  login.tsx                # Cognito sign-in
  (app)/                   # authenticated group (tab bar + guard)
    index.tsx  scan.tsx  profile.tsx
  check-in/
    scan.tsx               # public QR scanner (modal)
    [token].tsx            # resolve → verify → decision flow
src/
  features/auth/           # Cognito auth-service + types
  features/checkin/        # QrScanner, IdentityForm, DecisionView, hooks, types
  lib/                     # config, api-client, auth-storage, theme, query-client
  store/                   # zustand auth-store (SecureStore-backed)
  polyfills.ts             # crypto + Buffer for the Cognito SDK
```

Auth mirrors the admin-portal contract exactly: Cognito via
`amazon-cognito-identity-js`, roles from `cognito:groups`, `custom:tenant_id` /
`custom:assigned_sites` claims, and API calls carry `Authorization: <idToken>` +
`X-Tenant-Id`. Tokens persist in `expo-secure-store` (Keychain/Keystore), not
AsyncStorage.

## Configure

This app needs three **public** values (no secrets — the app talks to Cognito
directly, so there is no client secret). Set them in `app.json` under
`expo.extra`, or inject them per-environment via EAS:

```json
"extra": {
  "apiUrl": "https://<api-id>.execute-api.us-east-1.amazonaws.com/dev",
  "cognitoUserPoolId": "us-east-1_XXXXXXXXX",
  "cognitoClientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

Read them at runtime via `src/lib/config.ts` (`expo-constants`).

## Run

From the repo root (pnpm monorepo — `.npmrc` here hoists RN/Expo deps so Metro
resolves them):

```bash
pnpm install
pnpm --filter mobile start        # Expo dev server + QR for Expo Go / dev client
pnpm --filter mobile android      # build & run on a connected Android device/emulator
pnpm --filter mobile ios          # (later) iOS simulator
```

`expo-camera` needs a real device or a dev/prod build (not Expo Go's sandboxed
camera on all platforms) — use `expo run:android` or an EAS dev build.

## Build an APK

```bash
pnpm --filter mobile build:android:preview   # EAS preview profile → installable APK
```

## Test / lint / typecheck

```bash
pnpm --filter mobile test        # jest (extractToken unit tests)
pnpm --filter mobile typecheck   # tsc --noEmit
pnpm --filter mobile lint
```

## Notes

- `newArchEnabled: false` — the pinned deps target the classic RN architecture
  on SDK 51.
- iOS is wired (bundle id, camera usage string) but untested; the same screens
  render on both platforms.
