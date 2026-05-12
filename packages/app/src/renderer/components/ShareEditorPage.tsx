import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Download, PanelRight, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  TEMPLATE_RATIO,
  buildSpoolDocument,
  openSaveSlot,
  writeToSlot,
  rasterizeToPngBlob,
  PngTooTallError,
  filenameForExport,
  type Conversation,
  type EditorOpts,
} from '@spool/share-kit'
import type { ShareDraftSourceKind } from '@spool-lab/core'
import PageLayout from './PageLayout.js'
import { PreviewPane, type Zoom } from './share-editor/PreviewPane.js'
import { ControlPanel } from './share-editor/ControlPanel.js'
import { DownloadButton } from './share-editor/DownloadButton.js'
import { buildPreviewDocument } from '../lib/compose-from-session.js'

type Props = {
  /** Stable id of the share_drafts row to autosave into. */
  draftId: string
  sourceKind: ShareDraftSourceKind
  sourceOrigin: string | null
  conversation: Conversation
  /** Editor opts loaded from the persisted snapshot. The editor takes
   *  this as its initial state and persists any subsequent change. */
  initialOpts: EditorOpts
  onBack: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  /** PageLayout-relevant props passed down from App.tsx so the share
   *  editor can render its own PageLayout with the same sidebar/fold
   *  state as the rest of the app. */
  sidebar: ReactNode
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

type SaveState = 'idle' | 'saving' | 'error'

/**
 * Phase 0 share editor page. Renders the conversation through a
 * share-kit template and lets the user export the result locally —
 * PNG via html-to-image, PDF via the kit's print-to-PDF host, .spool
 * via JSON serialization. Style picker + turn-level editing land in
 * follow-up commits.
 */
export default function ShareEditorPage({
  draftId,
  sourceKind,
  sourceOrigin,
  conversation,
  initialOpts,
  onBack,
  panelOpen,
  onTogglePanel,
  sidebar,
  sidebarCollapsed,
  onToggleSidebar,
}: Props) {
  const [opts, setOpts] = useState<EditorOpts>(initialOpts)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const previewRef = useRef<HTMLDivElement | null>(null)

  // Autosave opts changes back into share_drafts. Debounced so a
  // rapid sequence of clicks (e.g. paging through colorways) collapses
  // into one upsert. We skip the very first effect run — that one
  // fires on mount with the value we just loaded from disk, no need
  // to write the same bytes back. Using a didMount ref instead of
  // identity-checking opts keeps this robust even if a parent re-render
  // produces a new conversation/opts object reference with no actual
  // change in content.
  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    const handle = window.setTimeout(() => {
      const doc = buildSpoolDocument(conversation, opts)
      void window.spool?.shareDraft?.upsert({
        draft_id: draftId,
        source_kind: sourceKind,
        source_origin: sourceOrigin,
        title: conversation.title,
        snapshot_json: JSON.stringify(doc),
        preview_json: JSON.stringify(buildPreviewDocument(doc)),
      }).catch((err) => console.error('Autosave share draft failed:', err))
    }, 400)
    return () => window.clearTimeout(handle)
  }, [opts, conversation, draftId, sourceKind, sourceOrigin])

  // Revoke the in-memory blob: URL when the preview modal closes so we
  // don't leak the PDF buffer for the rest of the session.
  useEffect(() => {
    if (!pdfPreview) return
    return () => URL.revokeObjectURL(pdfPreview.url)
  }, [pdfPreview])

  const meta = useMemo(() => {
    const wordLabel = `${conversation.wordCount.toLocaleString()} ${conversation.wordCount === 1 ? 'word' : 'words'}`
    return `${conversation.createdAt} · ${wordLabel}`
  }, [conversation])

  // Force React to commit the "Exporting…" state and let the browser
  // paint before kicking off rasterization. Without this, batched
  // updates + a blocking main thread keep the button at "Export" until
  // the work finishes, so the user gets no feedback that something is
  // happening.
  const beginSaving = useCallback(async () => {
    flushSync(() => setSaveState('saving'))
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  }, [])

  const exportPng = useCallback(async () => {
    const node = previewRef.current
    if (!node) return
    // PRE-PICK on the live user gesture, before any async work. If we
    // wait until after rasterization (~1-2s for a real conversation),
    // Chromium revokes the gesture and showSaveFilePicker rejects with
    // SecurityError.
    const filename = filenameForExport(conversation, opts.template, 'png')
    const slot = await openSaveSlot(filename, {
      description: 'PNG image',
      mime: 'image/png',
      ext: '.png',
    })
    if (slot.kind === 'cancelled') return

    await beginSaving()
    try {
      const width = TEMPLATE_RATIO[opts.template].w
      const height = node.scrollHeight
      const blob = await rasterizeToPngBlob(node, { width, height })
      await writeToSlot(slot, blob, filename)
      setSaveState('idle')
      toast.success(`Saved ${filename}`)
    } catch (err) {
      console.error('Export to PNG failed:', err)
      setSaveState('error')
      if (err instanceof PngTooTallError) {
        toast.error('Conversation too tall for PNG — try PDF export.')
      } else {
        toast.error('Export failed — see console for details')
      }
    }
  }, [beginSaving, conversation, opts.template])

  const exportPdf = useCallback(async () => {
    const node = previewRef.current
    if (!node) return
    await beginSaving()
    const width = TEMPLATE_RATIO[opts.template].w
    const height = node.scrollHeight
    const filename = filenameForExport(conversation, opts.template, 'pdf')
    try {
      const html = node.outerHTML
      const bytes = await window.spool.printToPdf(html, width, height)
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setPdfPreview({ url, filename })
      setSaveState('idle')
    } catch (err) {
      console.error('Export to PDF failed:', err)
      setSaveState('error')
      toast.error('Export failed — see console for details')
    }
  }, [beginSaving, conversation, opts.template])

  const savePdfFromPreview = useCallback(async () => {
    if (!pdfPreview) return
    const slot = await openSaveSlot(pdfPreview.filename, {
      description: 'PDF document',
      mime: 'application/pdf',
      ext: '.pdf',
    })
    if (slot.kind === 'cancelled') return
    const res = await fetch(pdfPreview.url)
    const blob = await res.blob()
    await writeToSlot(slot, blob, pdfPreview.filename)
    toast.success(`Saved ${pdfPreview.filename}`)
    setPdfPreview(null)
  }, [pdfPreview])

  const handleDelete = useCallback(async () => {
    try {
      await window.spool.shareDraft.delete(draftId)
    } catch (err) {
      console.error('Delete share draft failed:', err)
      toast.error('Could not delete draft')
      return
    }
    onBack()
  }, [draftId, onBack])

  const exportSpoolFile = useCallback(async () => {
    // Same pre-pick discipline as PNG; JSON.stringify is fast but
    // saveBlob's picker call still needs the user gesture.
    const filename = filenameForExport(conversation, opts.template, 'spool')
    const slot = await openSaveSlot(filename, {
      description: 'Spool Share document',
      mime: 'application/spool+json',
      ext: '.spool',
    })
    if (slot.kind === 'cancelled') return

    await beginSaving()
    try {
      const doc = buildSpoolDocument(conversation, opts)
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/spool+json' })
      await writeToSlot(slot, blob, filename)
      setSaveState('idle')
      toast.success(`Saved ${filename}`)
    } catch (err) {
      console.error('Export to .spool failed:', err)
      setSaveState('error')
      toast.error('Export failed — see console for details')
    }
  }, [beginSaving, conversation, opts])

  const topBarContent = (
    <div className="flex-1 min-w-0 flex items-center gap-2 px-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        title="Back"
        className="flex-none flex items-center justify-center w-5 h-5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
          <path d="M8 3L4 6.5L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div className="min-w-0 flex items-baseline gap-2">
        <h1
          className="min-w-0 text-[13px] font-medium text-warm-text dark:text-dark-text truncate"
          title={conversation.title}
        >
          {conversation.title}
        </h1>
        <span
          className="min-w-0 text-[11px] text-warm-faint dark:text-dark-muted truncate whitespace-nowrap"
          title={meta}
        >
          {meta}
        </span>
      </div>
      <EditorDeleteChip
        confirming={confirmingDelete}
        onClick={() => {
          if (confirmingDelete) {
            setConfirmingDelete(false)
            void handleDelete()
          } else {
            setConfirmingDelete(true)
          }
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
      <div className="flex-1" />
      <DownloadButton
        saving={saveState === 'saving'}
        onPng={() => { void exportPng() }}
        onPdf={() => { void exportPdf() }}
        onSpool={() => { void exportSpoolFile() }}
      />
      <button
        type="button"
        onClick={onTogglePanel}
        title={panelOpen ? 'Hide style panel' : 'Show style panel'}
        aria-label={panelOpen ? 'Hide style panel' : 'Show style panel'}
        aria-pressed={panelOpen}
        className="flex-none inline-flex items-center justify-center w-7 h-7 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
      >
        <PanelRight size={15} strokeWidth={1.75} />
      </button>
    </div>
  )

  return (
    <PageLayout
      sidebar={sidebar}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={onToggleSidebar}
      topBar={topBarContent}
      rightPanel={<ControlPanel opts={opts} setOpts={setOpts} />}
      rightPanelOpen={panelOpen}
    >
      <div className="flex flex-col h-full" data-testid="share-editor-page">
        {pdfPreview && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setPdfPreview(null)}
          >
            <div
              className="w-[80vw] max-w-[820px] h-[88vh] flex flex-col rounded-lg bg-warm-bg dark:bg-dark-bg shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-none flex items-center gap-3 px-4 py-2.5 border-b border-warm-border dark:border-dark-border">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-warm-text dark:text-dark-text truncate">{pdfPreview.filename}</p>
                  <p className="text-[10.5px] text-warm-faint dark:text-dark-muted">PDF preview · click outside to dismiss</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPdfPreview(null)}
                  className="h-7 px-2.5 rounded-md text-[12px] text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void savePdfFromPreview() }}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity"
                >
                  <Download size={12} strokeWidth={1.8} />
                  Save PDF
                </button>
              </div>
              <iframe src={pdfPreview.url} title="PDF preview" className="flex-1 w-full border-0 bg-white" />
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 flex">
          <PreviewPane
            ref={previewRef}
            convo={conversation}
            opts={opts}
            zoom={zoom}
            setZoom={setZoom}
          />
        </div>
      </div>
    </PageLayout>
  )
}

/**
 * Click-twice delete affordance in the editor top bar. Resting: a small
 * trash button. First click expands it into a "Delete?" pill with
 * destructive color. Second click fires onClick. Escape, mouse-leave,
 * or clicking outside cancels the primed state.
 */
/**
 * Click-twice delete affordance in the editor top bar. The outer wrapper
 * reserves a fixed 24×24 slot so neighbouring elements never move. When
 * primed, the inner span absolutely-positions itself and grows
 * rightward into a "Delete?" pill that overlays whatever sits beside it
 * — temporary visual occlusion is acceptable here; layout reflow is not.
 */
function EditorDeleteChip({
  confirming,
  onClick,
  onCancel,
}: {
  confirming: boolean
  onClick: () => void
  onCancel: () => void
}) {
  const wrapRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!confirming) return
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onCancel()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [confirming, onCancel])

  return (
    <button
      ref={wrapRef}
      type="button"
      data-testid="share-editor-delete"
      data-confirming={confirming ? '' : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      onMouseLeave={() => {
        if (confirming) onCancel()
      }}
      aria-label={confirming ? 'Click again to confirm delete' : 'Delete draft'}
      title={confirming ? 'Click again to confirm' : 'Delete draft'}
      className={`flex-none inline-flex items-center justify-center h-6 rounded cursor-pointer select-none transition-[width,padding,background-color,color] duration-150 text-[11.5px] font-medium tracking-[-0.005em] whitespace-nowrap overflow-hidden ${
        confirming
          ? 'w-[60px] px-2.5 bg-[color:var(--color-status-error)] dark:bg-[color:var(--color-status-error-dark)] text-white shadow-[0_1px_3px_rgba(0,0,0,0.18)]'
          : 'w-6 text-warm-faint dark:text-dark-muted hover:text-[color:var(--color-status-error)] dark:hover:text-[color:var(--color-status-error-dark)] hover:bg-[color:var(--color-status-error)]/8 dark:hover:bg-[color:var(--color-status-error-dark)]/12'
      }`}
    >
      {confirming ? 'Delete' : <Trash2 size={13} strokeWidth={1.75} />}
    </button>
  )
}
