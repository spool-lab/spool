import { useCallback, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import {
  TemplateRender,
  DEFAULT_OPTS,
  downloadSpoolFile,
  exportArtifact,
  type Conversation,
  type EditorOpts,
  type ExportFormat,
} from '@spool/share-kit'
import Menu from './Menu.js'

type Props = {
  conversation: Conversation
  onBack: () => void
}

type SaveState = 'idle' | 'saving' | 'error'

/**
 * Phase 0 share editor page. Renders the conversation through a
 * share-kit template and lets the user export the result locally —
 * PNG via html-to-image, PDF via the kit's print-to-PDF host, .spool
 * via JSON serialization. Style picker + turn-level editing land in
 * follow-up commits.
 */
export default function ShareEditorPage({ conversation, onBack }: Props) {
  const [opts] = useState<EditorOpts>(DEFAULT_OPTS)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const previewRef = useRef<HTMLDivElement | null>(null)

  const meta = useMemo(() => {
    const wordLabel = `${conversation.wordCount.toLocaleString()} ${conversation.wordCount === 1 ? 'word' : 'words'}`
    return [conversation.sourceLabel, conversation.createdAt, wordLabel, `~${conversation.readMin} min read`].join(' · ')
  }, [conversation])

  const exportImage = useCallback(async (format: ExportFormat) => {
    const node = previewRef.current
    if (!node) return
    setSaveState('saving')
    try {
      await exportArtifact(format, { node, template: opts.template, conversation })
      setSaveState('idle')
    } catch (err) {
      console.error(`Export to ${format} failed:`, err)
      setSaveState('error')
    }
  }, [conversation, opts.template])

  const exportSpoolFile = useCallback(async () => {
    setSaveState('saving')
    try {
      await downloadSpoolFile(conversation, opts)
      setSaveState('idle')
    } catch (err) {
      console.error('Export to .spool failed:', err)
      setSaveState('error')
    }
  }, [conversation, opts])

  return (
    <div className="flex flex-col h-full" data-testid="share-editor-page">
      <header className="flex-none flex items-start gap-3 px-6 pt-3 pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          title="Back"
          className="flex-none flex items-center justify-center w-5 h-5 mt-0.5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
            <path d="M8 3L4 6.5L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-medium text-warm-text dark:text-dark-text truncate" title={conversation.title}>
            {conversation.title}
          </h1>
          <p className="mt-1 text-[11px] text-warm-faint dark:text-dark-muted truncate">
            {meta}
          </p>
        </div>

        <div className="flex-none self-start mt-0.5">
          <Menu
            align="right"
            testId="share-editor-export"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                title="Export"
                aria-label="Export"
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={saveState === 'saving'}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-warm-text dark:text-dark-text bg-warm-surface dark:bg-dark-surface hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Download size={12} strokeWidth={1.8} />
                <span>{saveState === 'saving' ? 'Exporting…' : 'Export'}</span>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                  <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            items={[
              { label: 'Save as image (PNG)', onSelect: () => { void exportImage('png') } },
              { label: 'Save as PDF', onSelect: () => { void exportImage('pdf') } },
              { label: 'Save as .spool file', onSelect: () => { void exportSpoolFile() } },
            ]}
          />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto bg-warm-bg dark:bg-dark-bg">
        <div className="flex justify-center px-6 py-6">
          <div ref={previewRef} className="shadow-lg rounded-sm overflow-hidden">
            <TemplateRender template={opts.template} convo={conversation} opts={opts} />
          </div>
        </div>
      </div>
    </div>
  )
}
