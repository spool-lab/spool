# Connector Prerequisites & Setup Guide

**Date:** 2026-04-13
**Status:** Draft

## Problem

Connectors that depend on external CLI tools (opencli, gh) have no way to guide users through installation and setup. When checkAuth fails, the UI shows "Not connected" or a raw error message. The `hint` string returned by checkAuth is not displayed. Users don't know what to install, in what order, or where they're stuck.

## Design

Two-layer approach: static manifest prerequisites (visible before install) + dynamic checkAuth setup steps (live status after install).

### 1. Manifest: `prerequisites` Field

Optional string array in the `spool` section of `package.json`. Declares human-readable names of external dependencies. Used by the connector browser to show what's needed before the user installs.

```json
"spool": {
  "type": "connector",
  "prerequisites": ["OpenCLI", "Chrome Extension: OpenCLI Browser Bridge"]
}
```

Works for both single-connector and multi-connector packages. Omit if no external dependencies.

### 2. SDK: `SetupStep` Type

New type in `connector-sdk/src/connector.ts`:

```typescript
export interface SetupStep {
  /** Human-readable label for this step, e.g. "OpenCLI installed" */
  label: string
  /** ok = ready, missing = needs action, error = broken, pending = blocked by prior step */
  status: 'ok' | 'missing' | 'error' | 'pending'
  /** Guidance text shown next to the step */
  hint?: string
  /** Shell command the user can copy-paste to install */
  installCommand?: string
  /** URL to installation docs or download page */
  installUrl?: string
}
```

### 3. SDK: `AuthStatus.setup` Field

Add optional `setup` field to the existing `AuthStatus` interface:

```typescript
export interface AuthStatus {
  ok: boolean
  error?: SyncErrorCode
  message?: string
  hint?: string              // kept for backward compat
  setup?: SetupStep[]        // NEW: structured setup steps
}
```

When `setup` is present, UI renders the structured checklist. When absent, falls back to existing message/hint behavior. This means existing connectors (twitter-bookmarks, hackernews-hot, typeless) need zero changes.

### 4. Connector Implementation Pattern

Connectors with external dependencies implement checkAuth as a sequential check with dependency-aware status:

```typescript
async checkAuth(): Promise<AuthStatus> {
  const steps: SetupStep[] = []

  // Step 1: CLI installed?
  let cliOk = false
  try {
    const r = await caps.exec.run('opencli', ['--version'], { timeout: 5000 })
    cliOk = r.exitCode === 0
    steps.push({ label: 'OpenCLI installed', status: 'ok', hint: r.stdout.trim() })
  } catch {
    steps.push({
      label: 'OpenCLI installed',
      status: 'missing',
      installCommand: 'npm i -g @jackwener/opencli',
      installUrl: 'https://github.com/jackwener/opencli',
    })
  }

  // Step 2: depends on step 1
  if (!cliOk) {
    steps.push({ label: 'Browser Bridge connected', status: 'pending' })
    steps.push({ label: 'Logged in', status: 'pending' })
    return { ok: false, setup: steps }
  }

  // ... check bridge via `opencli doctor`, then connectivity
}
```

Steps that depend on a prior failing step are marked `pending`. The UI renders them greyed out.

### 5. UI Changes

#### 5a. Connector Browser (pre-install)

When a registry entry's package has `prerequisites`, the connector card shows a small label:

```
Requires: OpenCLI, Browser Bridge
```

Grey text, below the description. Informational only — does not block install.

Implementation: the registry JSON needs to carry prerequisites forward. Add optional `prerequisites: string[]` to `RegistryConnector` interface and `registry.json` entries.

#### 5b. SourcesPanel (post-install)

When a connector's sync state has a `setup` array (persisted from the last checkAuth result):

Replace the current amber error bar with a setup checklist:

| Status | Icon | Style |
|--------|------|-------|
| `ok` | checkmark | Green, muted |
| `missing` | X | Red, with hint text + optional copy button (installCommand) or link (installUrl) |
| `error` | warning | Amber, with hint text |
| `pending` | circle | Grey, muted |

Below the checklist: a "Retry" button that re-runs checkAuth.

When `setup` is absent, fall back to existing behavior (amber bar with lastErrorMessage).

### 6. Data Flow

```
checkAuth() → AuthStatus { setup: SetupStep[] }
     ↓
sync-engine persists setup in connector_sync_state (new column: setup_json TEXT)
     ↓
scheduler event → renderer receives setup steps
     ↓
SourcesPanel renders checklist
```

#### 6a. Schema Change

Add `setup_json` column to `connector_sync_state` table:

```sql
ALTER TABLE connector_sync_state ADD COLUMN setup_json TEXT DEFAULT NULL;
```

Stores `JSON.stringify(authStatus.setup)` after each checkAuth call. NULL when connector doesn't return setup steps.

### 7. Files Changed

**connector-sdk** (1 file):
- `src/connector.ts` — add `SetupStep` interface, add `setup?: SetupStep[]` to `AuthStatus`

**connector-sdk exports** (1 file):
- `src/index.ts` — export `SetupStep`

**core** (2 files):
- `src/connectors/sync-engine.ts` — persist `setup_json` after checkAuth
- `src/db/schema.ts` or migration — add `setup_json` column

**core types** (1 file):
- `src/connectors/types.ts` — add `setupJson` to SyncState type if needed

**connectors** (2 packages):
- `packages/connectors/github/src/index.ts` — return setup steps from checkAuth
- `packages/connectors/xiaohongshu/src/index.ts` — return setup steps from checkAuth

**registry** (1 file):
- `packages/landing/public/registry.json` — add `prerequisites` to github and xiaohongshu entries

**core registry types** (1 file):
- `src/connectors/registry-fetch.ts` — add optional `prerequisites: string[]` to `RegistryConnector`

**app UI** (2 files):
- `packages/app/src/renderer/components/SourcesPanel.tsx` — render setup checklist
- Connector browser component — render prerequisites label

### 8. Not In Scope

- Auto-installation of external tools (security concern, out of scope)
- Per-platform install commands (macOS vs Linux vs Windows) — single installCommand for now, can extend later
- Setup wizard modal — inline checklist is sufficient
