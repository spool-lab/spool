import { useState } from 'react'
import { Check, X, AlertTriangle, Circle, Terminal, Puzzle, KeyRound, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import type { SetupStep } from '@spool-lab/core'
import { ManualInstallModal } from './ManualInstallModal.js'

interface Props {
  packageId: string
  packageLabel: string
  steps: SetupStep[]
  onChanged: () => void
  /**
   * When true, render even if all prerequisites are OK; default collapsed
   * behind a summary row that the user can click to expand. Used in the
   * connector detail page so users can inspect prereq state any time.
   */
  alwaysShow?: boolean
}

function StatusIcon({ status }: { status: SetupStep['status'] }) {
  if (status === 'ok') return <Check className="w-3.5 h-3.5 text-green-500" />
  if (status === 'missing') return <X className="w-3.5 h-3.5 text-red-400" />
  if (status === 'outdated') return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
  if (status === 'error') return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
  return <Circle className="w-3.5 h-3.5 text-warm-faint dark:text-dark-faint" />
}

function KindIcon({ kind }: { kind: SetupStep['kind'] }) {
  if (kind === 'cli') return <Terminal className="w-3 h-3" />
  if (kind === 'browser-extension') return <Puzzle className="w-3 h-3" />
  return <KeyRound className="w-3 h-3" />
}

type InstallOutcome = { kind: 'error'; message: string } | { kind: 'requires-manual' } | null

function StepRow({ packageId, step, onChanged }: { packageId: string; step: SetupStep; onChanged: () => void }) {
  const [installId, setInstallId] = useState<string | null>(null)
  const installing = installId !== null
  const [outcome, setOutcome] = useState<InstallOutcome>(null)
  const [manualOpen, setManualOpen] = useState(false)

  const runCliInstall = async () => {
    const cid = `${packageId}::${step.id}::${Date.now()}`
    setInstallId(cid)
    setOutcome(null)
    const r = await window.spool?.connectors?.installCli(packageId, step.id, cid)
    setInstallId(null)
    if (!r) return
    if (r.ok) {
      onChanged()
      return
    }
    if (r.reason === 'requires-manual') {
      setOutcome({ kind: 'requires-manual' })
    } else if (r.reason === 'install-failed') {
      setOutcome({ kind: 'error', message: `Install failed (exit ${r.exitCode})` })
    } else {
      setOutcome({ kind: 'error', message: r.reason })
    }
  }

  const copyCommand = async () => {
    await window.spool?.connectors?.copyInstallCommand(packageId, step.id)
  }

  const cancelInstall = async () => {
    if (installId) await window.spool?.connectors?.cancelInstallCli(installId)
  }

  const needsAction = step.status === 'missing' || step.status === 'outdated' || step.status === 'error'
  const install = step.install

  const renderAction = () => {
    if (!needsAction || !install) return null

    if (install.kind === 'cli') {
      if (installing) {
        return (
          <div className="flex items-center gap-2 text-[11px] text-warm-muted dark:text-dark-muted">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Installing…</span>
            <button onClick={cancelInstall} className="text-[11px] text-warm-faint hover:text-warm-text dark:hover:text-dark-text">Cancel</button>
          </div>
        )
      }
      if (outcome) {
        return (
          <div className="flex items-center gap-2">
            {outcome.kind === 'error' && <span className="text-[11px] text-red-400">{outcome.message}</span>}
            <button onClick={runCliInstall} className="text-[11px] text-accent dark:text-accent-dark hover:underline">Retry</button>
            <button onClick={copyCommand} className="text-[11px] text-warm-muted dark:text-dark-muted hover:underline">Run manually</button>
          </div>
        )
      }
      return (
        <button onClick={runCliInstall} className="text-[11px] font-medium px-2 py-0.5 rounded border border-accent/30 text-accent dark:text-accent-dark hover:bg-accent/10 dark:hover:bg-accent-dark/10">
          {step.status === 'outdated' ? 'Upgrade' : 'Install'}
        </button>
      )
    }

    if (install.kind === 'browser-extension') {
      if (install.webstoreUrl) {
        return (
          <button onClick={() => window.spool?.connectors?.openExternal(install.webstoreUrl!)} className="text-[11px] font-medium px-2 py-0.5 rounded border border-accent/30 text-accent dark:text-accent-dark hover:bg-accent/10 dark:hover:bg-accent-dark/10">
            Install from Chrome Store
          </button>
        )
      }
      if (install.manual) {
        return (
          <button onClick={() => setManualOpen(true)} className="text-[11px] font-medium px-2 py-0.5 rounded border border-accent/30 text-accent dark:text-accent-dark hover:bg-accent/10 dark:hover:bg-accent-dark/10">
            Install extension
          </button>
        )
      }
    }

    if (install.kind === 'site-session') {
      return (
        <button onClick={() => window.spool?.connectors?.openExternal(install.openUrl)} className="text-[11px] font-medium px-2 py-0.5 rounded border border-accent/30 text-accent dark:text-accent-dark hover:bg-accent/10 dark:hover:bg-accent-dark/10">
          Open site
        </button>
      )
    }
    return null
  }

  return (
    <div className="flex items-start gap-2 py-1 min-h-[24px]">
      <span className="flex items-center h-[18px]">
        <StatusIcon status={step.status} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <KindIcon kind={step.kind} />
          <span className={`text-[11px] ${step.status === 'pending' ? 'text-warm-faint dark:text-dark-faint' : 'text-warm-text dark:text-dark-text'}`}>
            {step.label}
            {step.detectedVersion && step.status === 'ok' && <span className="ml-1 text-warm-faint dark:text-dark-faint">{step.detectedVersion}</span>}
          </span>
        </div>
        {step.hint && step.status !== 'ok' && (
          <div className="text-[10px] text-warm-faint dark:text-dark-faint mt-0.5">{step.hint}</div>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center h-[18px]">{renderAction()}</div>
      {install?.kind === 'browser-extension' && install.manual && (
        <ManualInstallModal
          open={manualOpen}
          onClose={() => setManualOpen(false)}
          manual={install.manual}
          prereqName={step.label}
          onCheck={async () => {
            await window.spool?.connectors?.recheckPrerequisites(packageId)
            setManualOpen(false)
          }}
        />
      )}
    </div>
  )
}

export function PackageSetupCard({ packageId, packageLabel: _packageLabel, steps, onChanged, alwaysShow }: Props) {
  const okCount = steps.filter(s => s.status === 'ok').length
  const allOk = okCount === steps.length

  // Default: when everything is set up, get out of the user's way entirely.
  // The card reappears automatically if any step regresses (focus recheck).
  // alwaysShow=true keeps the card visible (collapsed) so users can inspect.
  const [expanded, setExpanded] = useState(!allOk)
  if (allOk && !alwaysShow) return null

  const recheck = async () => {
    await window.spool?.connectors?.recheckPrerequisites(packageId)
  }

  // Collapsed summary for the "all ok + alwaysShow" case
  if (allOk && alwaysShow && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full px-3 py-2 bg-warm-panel dark:bg-dark-panel rounded-[6px] border border-warm-border dark:border-dark-border flex items-center justify-between text-left hover:border-warm-border-focus dark:hover:border-dark-border-focus transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronRight className="w-3 h-3 text-warm-faint dark:text-dark-faint" />
          <span className="text-[11px] font-medium text-warm-text dark:text-dark-text">Prerequisites</span>
        </div>
        <span className="text-[10px] text-warm-muted dark:text-dark-muted flex items-center gap-1">
          <Check className="w-3 h-3 text-green-500" />
          {steps.length} of {steps.length} ready
        </span>
      </button>
    )
  }

  return (
    <div className="px-3 py-2 bg-warm-panel dark:bg-dark-panel rounded-[6px] border border-warm-border dark:border-dark-border">
      <div className="flex items-center justify-between mb-1.5">
        {alwaysShow ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-warm-text dark:text-dark-text hover:text-warm-muted dark:hover:text-dark-muted"
            disabled={!allOk}
            title={allOk ? 'Collapse' : undefined}
          >
            {allOk && <ChevronDown className="w-3 h-3 text-warm-faint dark:text-dark-faint" />}
            <span>Prerequisites</span>
          </button>
        ) : (
          <span className="text-[11px] font-medium text-warm-text dark:text-dark-text">Setup</span>
        )}
        <div className="flex items-center gap-2 text-[10px] text-warm-muted dark:text-dark-muted">
          <span>{okCount} of {steps.length} ✓</span>
          <button onClick={recheck} className="hover:text-warm-text dark:hover:text-dark-text">Re-check</button>
        </div>
      </div>
      <div className="space-y-0.5">
        {steps.map(s => <StepRow key={s.id} packageId={packageId} step={s} onChanged={onChanged} />)}
      </div>
    </div>
  )
}
