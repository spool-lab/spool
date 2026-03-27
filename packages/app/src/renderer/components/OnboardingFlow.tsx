import { useState, useEffect, useCallback } from 'react'

type Step = 'welcome' | 'install' | 'bridge' | 'done'

interface Props {
  onClose: () => void
  onComplete: () => void
}

export default function OnboardingFlow({ onClose, onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome')
  const [checking, setChecking] = useState(false)
  const [cliInstalled, setCliInstalled] = useState(false)
  const [bridgeReady, setBridgeReady] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [bridgeError, setBridgeError] = useState<string | null>(null)

  const checkStatus = useCallback(async () => {
    if (!window.spool?.opencli) return
    setChecking(true)
    setBridgeError(null)
    try {
      const status = await window.spool.opencli.checkSetup()
      setCliInstalled(status.cliInstalled)
      setBridgeReady(status.browserBridgeReady)
      if (status.cliInstalled && step === 'install') setStep('bridge')
      if (status.browserBridgeReady && step === 'bridge') {
        setStep('done')
      } else if (step === 'bridge' && !status.browserBridgeReady) {
        setBridgeError('Browser Bridge not detected. Make sure the Chrome extension is installed and Chrome is running.')
      }
    } catch {
      if (step === 'bridge') {
        setBridgeError('Could not check bridge status. Make sure OpenCLI is installed correctly.')
      }
    } finally {
      setChecking(false)
    }
  }, [step])

  useEffect(() => { checkStatus() }, [])

  const handleInstall = async () => {
    if (!window.spool?.opencli) return
    setInstalling(true)
    setInstallError(null)
    const result = await window.spool.opencli.installCli()
    setInstalling(false)
    if (result.ok) {
      setCliInstalled(true)
      setStep('bridge')
    } else {
      setInstallError(result.error ?? 'Installation failed')
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText('npm install -g @jackwener/opencli')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleComplete = async () => {
    if (window.spool?.opencli) {
      await window.spool.opencli.setSetupValue('onboarding_complete', 'true')
    }
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[460px] bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border rounded-[10px] shadow-xl overflow-hidden">
        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 pt-5 pb-3">
          {(['welcome', 'install', 'bridge', 'done'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s === step
                  ? 'bg-accent dark:bg-accent-dark'
                  : i < ['welcome', 'install', 'bridge', 'done'].indexOf(step)
                    ? 'bg-accent/40 dark:bg-accent-dark/40'
                    : 'bg-warm-border2 dark:bg-dark-border2'
              }`}
            />
          ))}
        </div>

        <div className="px-6 pb-6">
          {step === 'welcome' && (
            <>
              <h2 className="text-lg font-semibold text-warm-text dark:text-dark-text mb-2">
                Connect your data sources
              </h2>
              <p className="text-sm text-warm-muted dark:text-dark-muted mb-4 leading-relaxed">
                Spool uses OpenCLI to pull your bookmarks, stars, and saves from 50+ platforms.
                It reuses your existing Chrome login sessions — no API keys or tokens needed.
              </p>
              <p className="text-xs text-warm-faint dark:text-dark-muted mb-6">
                Everything stays local on your machine.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors rounded-[6px]">
                  Later
                </button>
                <button onClick={() => setStep('install')} className="px-4 py-2 text-sm font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity rounded-[6px]">
                  Get started
                </button>
              </div>
            </>
          )}

          {step === 'install' && (
            <>
              <h2 className="text-lg font-semibold text-warm-text dark:text-dark-text mb-2">
                Install OpenCLI
              </h2>
              <p className="text-sm text-warm-muted dark:text-dark-muted mb-4">
                Run this command in your terminal:
              </p>
              <div className="flex items-center gap-2 mb-4">
                <code className="flex-1 px-3 py-2.5 bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[8px] text-xs font-mono text-warm-text dark:text-dark-text select-all">
                  npm install -g @jackwener/opencli
                </code>
                <button
                  onClick={handleCopy}
                  className="px-3 py-2.5 text-xs font-medium text-warm-muted dark:text-dark-muted bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[8px] hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {installError && (
                <p className="text-xs text-red-500 mb-3">{installError}</p>
              )}
              <div className="flex justify-between items-center">
                <button
                  onClick={handleInstall}
                  disabled={installing}
                  className="text-xs text-accent dark:text-accent-dark hover:underline disabled:opacity-50"
                >
                  {installing ? 'Installing...' : 'Or install automatically'}
                </button>
                <div className="flex gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-sm text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors rounded-[6px]">
                    Cancel
                  </button>
                  <button
                    onClick={checkStatus}
                    disabled={checking}
                    className="px-4 py-2 text-sm font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity rounded-[6px] disabled:opacity-50"
                  >
                    {checking ? 'Checking...' : 'Verify'}
                  </button>
                </div>
              </div>
              {cliInstalled && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-3">OpenCLI detected. Moving on...</p>
              )}
            </>
          )}

          {step === 'bridge' && (
            <>
              <h2 className="text-lg font-semibold text-warm-text dark:text-dark-text mb-2">
                Browser Bridge
              </h2>
              <p className="text-sm text-warm-muted dark:text-dark-muted mb-4 leading-relaxed">
                OpenCLI needs a lightweight Chrome extension to access your login sessions.
                Install the Browser Bridge extension, then click Verify.
              </p>
              <p className="text-xs text-warm-faint dark:text-dark-muted mb-4">
                Make sure Chrome is running and you're logged into the platforms you want to connect.
              </p>
              {bridgeError && (
                <p className="text-xs text-red-500 mb-3">{bridgeError}</p>
              )}
              <div className="flex justify-between items-center">
                <button
                  onClick={() => setStep('done')}
                  className="text-xs text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:underline"
                >
                  Skip for now
                </button>
                <div className="flex gap-3">
                  <button onClick={() => setStep('install')} className="px-4 py-2 text-sm text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors rounded-[6px]">
                    Back
                  </button>
                  <button
                    onClick={checkStatus}
                    disabled={checking}
                    className="px-4 py-2 text-sm font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity rounded-[6px] disabled:opacity-50"
                  >
                    {checking ? 'Checking...' : 'Verify'}
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="text-center py-4">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600 dark:text-green-400">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-warm-text dark:text-dark-text mb-2">
                  You're all set
                </h2>
                <p className="text-sm text-warm-muted dark:text-dark-muted mb-6">
                  OpenCLI is ready. Add your first data source to start indexing.
                </p>
              </div>
              <div className="flex justify-center">
                <button
                  onClick={handleComplete}
                  className="px-5 py-2 text-sm font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity rounded-[6px]"
                >
                  Add your first source
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
