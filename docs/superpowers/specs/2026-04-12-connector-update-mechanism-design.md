# Connector Update Mechanism

## Problem

Installed connectors stay at whatever version they were installed at. There is no version check, no upgrade prompt, and no way for users to know an update is available.

## Solution

Check npm registry for newer versions on app launch (async, non-blocking) and expose update availability in the connector detail view. Users can one-click update from the detail page.

## Data Flow

1. After `loadConnectors` completes at startup, call `checkForUpdates` for each non-bundled connector
2. Store results in an in-memory `Map<packageName, { current: string, latest: string }>` in main process
3. Expose via IPC to renderer
4. Connector detail view shows update prompt when `latest > current`
5. User clicks Update → main process downloads, installs, reloads → renderer refreshes

## Changes by Layer

### Core (`packages/core/src/connectors/npm-install.ts`)

New function:

```typescript
checkForUpdates(
  connectors: Array<{ packageName: string; currentVersion: string }>,
  fetchFn: typeof fetch
): Promise<Map<string, { current: string; latest: string }>>
```

- Calls `resolveNpmPackage` for each connector in parallel
- Compares installed version (from package.json) against npm latest
- Returns only entries where `semver.gt(latest, current)`
- Swallows individual fetch failures (network down, package delisted) — no update shown is fine

### Main Process (`packages/app/src/main/index.ts`)

- After startup load completes, fire `checkForUpdates` asynchronously (do not block app startup)
- Cache results in a module-level Map
- New IPC handlers:
  - `connector:check-updates` — re-run `checkForUpdates`, refresh cache, return results
  - `connector:update` — given a package name: stop connector sync → `downloadAndInstall` → reload connectors → clear update cache entry → emit `connector:event { type: 'updated' }`

### Preload (`packages/app/src/preload/index.ts`)

New methods on `connectors` API:

```typescript
checkUpdates(): Promise<Record<string, { current: string; latest: string }>>
update(connectorId: string): Promise<{ ok: boolean; error?: string }>
```

### Renderer (`packages/app/src/renderer/components/SettingsPanel.tsx`)

In connector detail view:

- On mount / after manual check: call `checkUpdates()`, store state
- If update available for current connector: show "v1.2.0 → v1.3.0" label + "Update" button
- Button states: idle → updating (spinner) → success (refresh) / error (show message, button re-enabled)
- Failed update: show inline error text, old version continues working

## Update Execution Flow

1. User clicks Update
2. Main process: pause scheduler for this connector
3. `downloadAndInstall(packageName, connectorsDir, fetchFn)` — overwrites existing files
4. `loadConnectors(deps)` — rediscovers and reloads all connectors
5. Resume scheduler
6. Success: emit `{ type: 'updated', name, version }` event → renderer refreshes detail view
7. Failure: return `{ ok: false, error }` → renderer shows error, old version unaffected

## What We Don't Do

- No DB schema changes (version lives in package.json already)
- No periodic background polling (launch + manual check is sufficient)
- No auto-update (user-initiated only)
- No update check for bundled connectors (managed by app updates)
- No confirmation dialog (low-risk operation on already-trusted connector)

## Check Timing

- **On launch**: async after `loadConnectors`, non-blocking
- **Manual**: user triggers from Settings panel (re-checks all connectors)
