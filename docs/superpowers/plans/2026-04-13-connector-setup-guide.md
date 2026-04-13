# Connector Setup Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured setup steps to checkAuth so the UI can render a checklist guiding users through external dependency installation.

**Architecture:** `SetupStep` type added to SDK. Connectors return `setup: SetupStep[]` from checkAuth. Main process caches setup steps in memory and includes them on `ConnectorStatus`. SourcesPanel renders a checklist when setup steps exist. Connector browser shows static prerequisites from registry. No schema migration needed.

**Tech Stack:** TypeScript, React (TSX), Tailwind CSS

---

### Task 1: Add SetupStep type to connector-sdk

**Files:**
- Modify: `packages/connector-sdk/src/connector.ts`
- Modify: `packages/connector-sdk/src/index.ts`

- [ ] **Step 1: Add SetupStep interface and update AuthStatus**

In `packages/connector-sdk/src/connector.ts`, add before the `AuthStatus` interface:

```typescript
export interface SetupStep {
  label: string
  status: 'ok' | 'missing' | 'error' | 'pending'
  hint?: string
  installCommand?: string
  installUrl?: string
}
```

Add `setup` field to `AuthStatus`:

```typescript
export interface AuthStatus {
  ok: boolean
  error?: SyncErrorCode
  message?: string
  hint?: string
  setup?: SetupStep[]
}
```

- [ ] **Step 2: Export SetupStep from index.ts**

In `packages/connector-sdk/src/index.ts`, change the first export line:

```typescript
export type { Connector, AuthStatus, PageResult, FetchContext, SetupStep } from './connector.js'
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/connector-sdk && pnpm build`
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add packages/connector-sdk/src/connector.ts packages/connector-sdk/src/index.ts
git commit -m "feat(connector-sdk): add SetupStep type and AuthStatus.setup field"
```

---

### Task 2: Update GitHub connector to return setup steps

**Files:**
- Modify: `packages/connectors/github/src/index.ts`

- [ ] **Step 1: Rewrite checkGhAuth to return setup steps**

Replace the `checkGhAuth` function in `packages/connectors/github/src/index.ts`:

```typescript
import type { SetupStep } from '@spool/connector-sdk'

async function checkGhAuth(caps: ConnectorCapabilities): Promise<AuthStatus> {
  const steps: SetupStep[] = []

  // Step 1: gh CLI installed?
  let cliOk = false
  try {
    const result = await caps.exec.run('gh', ['--version'], { timeout: 5000 })
    cliOk = result.exitCode === 0
    steps.push({ label: 'GitHub CLI installed', status: 'ok', hint: result.stdout.split('\n')[0] })
  } catch {
    steps.push({
      label: 'GitHub CLI installed',
      status: 'missing',
      hint: 'Required to access GitHub API',
      installCommand: 'brew install gh',
      installUrl: 'https://cli.github.com',
    })
    steps.push({ label: 'Authenticated with GitHub', status: 'pending' })
    return { ok: false, error: SyncErrorCode.AUTH_NOT_LOGGED_IN, setup: steps }
  }

  // Step 2: gh authenticated?
  const authResult = await caps.exec.run('gh', ['auth', 'status'], { timeout: 5000 })
  if (authResult.exitCode === 0) {
    steps.push({ label: 'Authenticated with GitHub', status: 'ok' })
    return { ok: true, setup: steps }
  }

  steps.push({
    label: 'Authenticated with GitHub',
    status: 'missing',
    hint: 'Run gh auth login to authenticate',
    installCommand: 'gh auth login',
  })
  return { ok: false, error: SyncErrorCode.AUTH_NOT_LOGGED_IN, setup: steps }
}
```

Also add `SetupStep` to the import from `@spool/connector-sdk`:

```typescript
import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
  CapturedItem,
  SetupStep,
} from '@spool/connector-sdk'
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/connectors/github && pnpm build`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/github/src/index.ts
git commit -m "feat(connector-github): return structured setup steps from checkAuth"
```

---

### Task 3: Update Xiaohongshu connector to return setup steps

**Files:**
- Modify: `packages/connectors/xiaohongshu/src/index.ts`

- [ ] **Step 1: Rewrite checkOpenCLI to return setup steps**

Replace the `checkOpenCLI` function in `packages/connectors/xiaohongshu/src/index.ts`:

```typescript
import type { SetupStep } from '@spool/connector-sdk'

async function checkOpenCLI(caps: ConnectorCapabilities): Promise<AuthStatus> {
  const steps: SetupStep[] = []

  // Step 1: opencli installed?
  let cliOk = false
  try {
    const result = await caps.exec.run('opencli', ['--version'], { timeout: 5000 })
    cliOk = result.exitCode === 0
    steps.push({ label: 'OpenCLI installed', status: 'ok', hint: result.stdout.trim() })
  } catch {
    steps.push({
      label: 'OpenCLI installed',
      status: 'missing',
      hint: 'Command-line tool for Xiaohongshu',
      installCommand: 'npm i -g @jackwener/opencli',
      installUrl: 'https://github.com/jackwener/opencli',
    })
    steps.push({ label: 'Browser Bridge connected', status: 'pending' })
    steps.push({ label: 'Xiaohongshu accessible', status: 'pending' })
    return { ok: false, error: SyncErrorCode.AUTH_NOT_LOGGED_IN, setup: steps }
  }

  // Step 2: browser bridge connected?
  let bridgeOk = false
  try {
    const doctor = await caps.exec.run('opencli', ['doctor'], { timeout: 10000 })
    const out = doctor.stdout + doctor.stderr
    bridgeOk = /\[OK\].*Extension/i.test(out)
    if (bridgeOk) {
      steps.push({ label: 'Browser Bridge connected', status: 'ok' })
    } else {
      steps.push({
        label: 'Browser Bridge connected',
        status: 'missing',
        hint: 'Install the opencli Chrome extension',
        installUrl: 'https://github.com/jackwener/opencli/releases',
      })
    }
  } catch {
    steps.push({
      label: 'Browser Bridge connected',
      status: 'error',
      hint: 'Could not check bridge status',
    })
  }

  if (!bridgeOk) {
    steps.push({ label: 'Xiaohongshu accessible', status: 'pending' })
    return { ok: false, error: SyncErrorCode.AUTH_NOT_LOGGED_IN, setup: steps }
  }

  // Step 3: connectivity (implies logged in)
  try {
    const doctor = await caps.exec.run('opencli', ['doctor'], { timeout: 10000 })
    const out = doctor.stdout + doctor.stderr
    const connOk = /\[OK\].*Connectivity/i.test(out)
    if (connOk) {
      steps.push({ label: 'Xiaohongshu accessible', status: 'ok' })
      return { ok: true, setup: steps }
    }
    steps.push({
      label: 'Xiaohongshu accessible',
      status: 'missing',
      hint: 'Open Chrome and log into xiaohongshu.com',
    })
  } catch {
    steps.push({
      label: 'Xiaohongshu accessible',
      status: 'error',
      hint: 'Could not check connectivity',
    })
  }

  return { ok: false, error: SyncErrorCode.AUTH_NOT_LOGGED_IN, setup: steps }
}
```

Also add `SetupStep` to the import:

```typescript
import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
  SetupStep,
} from '@spool/connector-sdk'
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/connectors/xiaohongshu && pnpm build`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/xiaohongshu/src/index.ts
git commit -m "feat(connector-xiaohongshu): return structured setup steps from checkAuth"
```

---

### Task 4: Propagate setup steps through ConnectorStatus to the renderer

**Files:**
- Modify: `packages/core/src/connectors/types.ts`
- Modify: `packages/app/src/main/index.ts`

- [ ] **Step 1: Add setupJson to ConnectorStatus**

In `packages/core/src/connectors/types.ts`, add to the `ConnectorStatus` interface (after `state: SyncState`):

```typescript
export interface ConnectorStatus {
  id: string
  label: string
  description: string
  platform: string
  color: string
  enabled: boolean
  syncing: boolean
  bundled: boolean
  version: string
  state: SyncState
  setup?: Array<{
    label: string
    status: 'ok' | 'missing' | 'error' | 'pending'
    hint?: string
    installCommand?: string
    installUrl?: string
  }>
}
```

- [ ] **Step 2: Cache setup steps in main process and include in connector:list**

In `packages/app/src/main/index.ts`, add a module-level cache after the existing variables (around line 30-ish, near the `bundledConnectorIds` declaration):

```typescript
const connectorSetupCache = new Map<string, any[]>()
```

Update the `connector:check-auth` handler (~line 716) to cache the setup steps:

```typescript
ipcMain.handle('connector:check-auth', async (_e, { id }: { id: string }): Promise<AuthStatus> => {
  const connector = connectorRegistry.get(id)
  const result = await connector.checkAuth()
  if (result.setup) {
    connectorSetupCache.set(id, result.setup)
  } else {
    connectorSetupCache.delete(id)
  }
  return result
})
```

Update the `connector:set-enabled` handler (~line 730) to run checkAuth when enabling:

```typescript
ipcMain.handle('connector:set-enabled', async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
  const state = loadSyncState(db, id)
  saveSyncState(db, { ...state, enabled })
  if (enabled) {
    // Run checkAuth to populate setup steps before first sync
    try {
      const connector = connectorRegistry.get(id)
      const auth = await connector.checkAuth()
      if (auth.setup) connectorSetupCache.set(id, auth.setup)
      else connectorSetupCache.delete(id)
    } catch {}
    syncScheduler.triggerNow(id, 'both')
  }
  return { ok: true }
})
```

Update the `connector:list` handler (~line 706) to include setup:

```typescript
ipcMain.handle('connector:list', (): ConnectorStatus[] => {
  const installed = getInstalledConnectorPackages()
  const versionMap = new Map(installed.map(p => [p.connectorId, p.currentVersion]))
  return syncScheduler.getStatus().connectors.map(c => ({
    ...c,
    bundled: bundledConnectorIds.has(c.id),
    version: versionMap.get(c.id) ?? '0.0.0',
    setup: connectorSetupCache.get(c.id),
  }))
})
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/connectors/types.ts packages/app/src/main/index.ts
git commit -m "feat(core): propagate setup steps through ConnectorStatus to renderer"
```

---

### Task 5: Render setup checklist in SourcesPanel

**Files:**
- Modify: `packages/app/src/renderer/components/SourcesPanel.tsx`

- [ ] **Step 1: Add SetupChecklist component and update error rendering**

In `packages/app/src/renderer/components/SourcesPanel.tsx`, add a `SetupChecklist` component after the `BuiltInSource` component at the bottom of the file:

```typescript
function SetupChecklist({ steps, onRetry }: {
  steps: Array<{
    label: string
    status: 'ok' | 'missing' | 'error' | 'pending'
    hint?: string
    installCommand?: string
    installUrl?: string
  }>
  onRetry: () => void
}) {
  return (
    <div className="ml-5 mt-1.5 space-y-1.5">
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-0.5 text-[11px] leading-none">
            {step.status === 'ok' && <span className="text-green-500">&#10003;</span>}
            {step.status === 'missing' && <span className="text-red-400">&#10007;</span>}
            {step.status === 'error' && <span className="text-amber-500">!</span>}
            {step.status === 'pending' && <span className="text-warm-faint dark:text-dark-faint">&#9675;</span>}
          </span>
          <div className="flex-1 min-w-0">
            <span className={`text-[11px] ${
              step.status === 'pending' ? 'text-warm-faint dark:text-dark-faint' :
              step.status === 'ok' ? 'text-warm-muted dark:text-dark-muted' :
              'text-warm-text dark:text-dark-text'
            }`}>
              {step.label}
            </span>
            {step.hint && step.status !== 'ok' && (
              <span className="text-[10px] text-warm-faint dark:text-dark-faint ml-1.5">{step.hint}</span>
            )}
            {step.installCommand && step.status === 'missing' && (
              <button
                onClick={() => navigator.clipboard.writeText(step.installCommand!)}
                className="ml-1.5 text-[10px] font-mono text-accent dark:text-accent-dark hover:underline"
                title="Copy to clipboard"
              >
                {step.installCommand}
              </button>
            )}
            {step.installUrl && !step.installCommand && step.status === 'missing' && (
              <a
                href={step.installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1.5 text-[10px] text-accent dark:text-accent-dark hover:underline"
              >
                Docs
              </a>
            )}
          </div>
        </div>
      ))}
      <button
        onClick={onRetry}
        className="text-[10px] text-accent dark:text-accent-dark hover:underline mt-1"
      >
        Retry
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Replace the amber error bar with conditional setup checklist**

Replace the amber error bar block (lines 193-199 in SourcesPanel.tsx):

```typescript
              {connectors.some(c => c.state.lastErrorCode) && (
                <div className="mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-[6px]">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {connectors.find(c => c.state.lastErrorCode)?.state.lastErrorMessage}
                  </p>
                </div>
              )}
```

With:

```typescript
              {connectors.some(c => c.state.lastErrorCode && !(c as any).setup) && (
                <div className="mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-[6px]">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {connectors.find(c => c.state.lastErrorCode && !(c as any).setup)?.state.lastErrorMessage}
                  </p>
                </div>
              )}
```

- [ ] **Step 3: Add setup checklist rendering per connector**

After the syncing progress indicator (after line 189, inside the connector map), add the setup checklist:

```typescript
                    {!isSyncing && (c as any).setup && !c.state.lastForwardSyncAt && (
                      <SetupChecklist
                        steps={(c as any).setup}
                        onRetry={async () => {
                          if (!window.spool?.connectors) return
                          await window.spool.connectors.checkAuth(c.id)
                          await loadConnectors()
                        }}
                      />
                    )}
```

This goes right before the closing `</div>` of each connector's block (before line 191 `</div>`).

- [ ] **Step 4: Build and verify**

Run: `cd packages/app && pnpm build` or start dev mode to verify visually.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/components/SourcesPanel.tsx
git commit -m "feat(ui): render setup checklist in SourcesPanel for connectors with setup steps"
```

---

### Task 6: Add prerequisites to registry and connector browser

**Files:**
- Modify: `packages/core/src/connectors/registry-fetch.ts`
- Modify: `packages/landing/public/registry.json`
- Modify: `packages/app/src/renderer/components/SettingsPanel.tsx`

- [ ] **Step 1: Add prerequisites to RegistryConnector type**

In `packages/core/src/connectors/registry-fetch.ts`, add to the `RegistryConnector` interface:

```typescript
export interface RegistryConnector {
  name: string
  id: string
  platform: string
  label: string
  description: string
  color: string
  author: string
  category: string
  firstParty: boolean
  bundled: boolean
  npm: string
  prerequisites?: string[]
}
```

- [ ] **Step 2: Add prerequisites to registry.json entries**

In `packages/landing/public/registry.json`, add `"prerequisites"` to the github and xiaohongshu entries:

For all github entries (github-stars and github-notifications), add:
```json
"prerequisites": ["GitHub CLI (gh)"]
```

For all xiaohongshu entries (xiaohongshu-feed, xiaohongshu-notes, xiaohongshu-notifications), add:
```json
"prerequisites": ["OpenCLI", "Browser Bridge"]
```

- [ ] **Step 3: Render prerequisites in SettingsPanel connector browser**

In `packages/app/src/renderer/components/SettingsPanel.tsx`, find the available connectors rendering (around line 641-642). After the description span, add:

```typescript
                <span className="text-xs text-warm-muted dark:text-dark-muted">{rc.label}</span>
                <span className="text-[11px] text-warm-faint dark:text-dark-faint ml-2">{rc.description}</span>
                {rc.prerequisites && rc.prerequisites.length > 0 && (
                  <div className="text-[10px] text-warm-faint dark:text-dark-faint mt-0.5">
                    Requires: {rc.prerequisites.join(', ')}
                  </div>
                )}
```

- [ ] **Step 4: Build core and verify**

Run: `cd packages/core && pnpm build`
Expected: Clean compile.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/connectors/registry-fetch.ts packages/landing/public/registry.json packages/app/src/renderer/components/SettingsPanel.tsx
git commit -m "feat: show prerequisites in connector browser before install"
```

---

### Task 7: Build and visual test

- [ ] **Step 1: Rebuild everything**

Run: `pnpm --filter @spool/connector-sdk build && pnpm --filter @spool/core build && pnpm --filter @spool-lab/connector-github build && pnpm --filter @spool-lab/connector-xiaohongshu build`
Expected: All compile clean.

- [ ] **Step 2: Start app dev mode and verify**

Run: `cd packages/app && pnpm dev`

Verify:
- Open Settings → Connectors → "Available Connectors" section shows "Requires: GitHub CLI (gh)" and "Requires: OpenCLI, Browser Bridge"
- Open SourcesPanel → Click "Connect" on a GitHub connector → should show setup checklist with green checkmarks (gh is installed and authed)
- Click "Connect" on a Xiaohongshu connector → should show setup checklist with "OpenCLI installed" as missing + copy-able install command, and subsequent steps as pending
- Click "Retry" after installing a dependency → checklist updates

- [ ] **Step 3: Commit any remaining changes**

```bash
git add -A && git commit -m "chore: rebuild for setup guide feature"
```
