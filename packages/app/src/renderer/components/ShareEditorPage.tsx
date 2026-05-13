import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Download, MoreHorizontal, PanelRight, Pencil, Trash2 } from 'lucide-react'
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
import Menu from './Menu.js'
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
  // Draft title state. Mirrors share_drafts.title; we override
  // conversation.title at save time so the snapshot stays in sync.
  // Renamed via a modal (the Pencil button next to the title opens it).
  // Empty strings persist as-is during the edit but resolve to a sane
  // fallback ("Untitled") at render time so the Shares grid never shows
  // a blank card label.
  const [title, setTitle] = useState<string>(conversation.title)
  const [renaming, setRenaming] = useState(false)
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
      const effectiveTitle = title.trim() || 'Untitled'
      const convoWithTitle = { ...conversation, title: effectiveTitle }
      const doc = buildSpoolDocument(convoWithTitle, opts)
      void window.spool?.shareDraft?.upsert({
        draft_id: draftId,
        source_kind: sourceKind,
        source_origin: sourceOrigin,
        title: effectiveTitle,
        snapshot_json: JSON.stringify(doc),
        preview_json: JSON.stringify(buildPreviewDocument(doc)),
      }).catch((err) => console.error('Autosave share draft failed:', err))
    }, 400)
    return () => window.clearTimeout(handle)
  }, [opts, conversation, draftId, sourceKind, sourceOrigin, title])

  // Revoke the in-memory blob: URL when the preview modal closes so we
  // don't leak the PDF buffer for the rest of the session.
  useEffect(() => {
    if (!pdfPreview) return
    return () => URL.revokeObjectURL(pdfPreview.url)
  }, [pdfPreview])

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
        toast.error("Couldn't export PNG", { description: 'Conversation too tall — try PDF instead.' })
      } else {
        toast.error("Couldn't export PNG", { description: 'See console for details.' })
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
      toast.error("Couldn't export PDF", { description: 'See console for details.' })
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
    try {
      const res = await fetch(pdfPreview.url)
      const blob = await res.blob()
      await writeToSlot(slot, blob, pdfPreview.filename)
      toast.success(`Saved ${pdfPreview.filename}`)
      setPdfPreview(null)
    } catch (err) {
      console.error('Save PDF failed:', err)
      toast.error("Couldn't save PDF", { description: 'See console for details.' })
    }
  }, [pdfPreview])

  const handleDelete = useCallback(async () => {
    try {
      await window.spool.shareDraft.delete(draftId)
    } catch (err) {
      console.error('Delete share draft failed:', err)
      toast.error("Couldn't delete draft")
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
      toast.error("Couldn't export .spool", { description: 'See console for details.' })
    }
  }, [beginSaving, conversation, opts])

  const topBarContent = (
    <div className="flex-1 min-w-0 flex items-center gap-2 px-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        title="Back"
        className="flex-none flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M8 3L4 6.5L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div className="min-w-0 flex items-center gap-1.5">
        <h1
          data-testid="share-editor-title"
          title={title.trim() || 'Untitled'}
          className="min-w-0 text-[13px] font-medium text-warm-text dark:text-dark-text truncate"
        >
          {title.trim() || 'Untitled'}
        </h1>
        <Menu
          align="left"
          testId="share-editor-more"
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-label="More options"
              title="More options"
              className="flex-none inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
            >
              <MoreHorizontal size={13} strokeWidth={1.6} aria-hidden />
            </button>
          )}
          items={[
            {
              label: 'Rename draft',
              icon: <Pencil size={13} strokeWidth={1.6} aria-hidden />,
              onSelect: () => setRenaming(true),
            },
            {
              label: 'Delete draft',
              icon: <Trash2 size={13} strokeWidth={1.6} aria-hidden />,
              onSelect: () => setConfirmingDelete(true),
            },
          ]}
        />
      </div>
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
        className="flex-none inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
      >
        <PanelRight size={13} strokeWidth={1.75} />
      </button>
    </div>
  )

  return (
    <PageLayout
      sidebar={sidebar}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={onToggleSidebar}
      topBar={topBarContent}
      rightPanel={<ControlPanel convo={conversation} opts={opts} setOpts={setOpts} />}
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
      {renaming && (
        <RenameDraftModal
          initialTitle={title}
          onSave={setTitle}
          onClose={() => setRenaming(false)}
        />
      )}
      {confirmingDelete && (
        <DeleteDraftModal
          title={title.trim() || 'Untitled'}
          onConfirm={async () => {
            setConfirmingDelete(false)
            await handleDelete()
          }}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </PageLayout>
  )
}

/**
 * Rename-draft modal — opens from the Pencil button next to the title.
 * Centered overlay matching the rest of the cmdk-family surfaces
 * (warm-bg backdrop blur + warm-bg panel). Esc cancels, Enter saves,
 * click outside cancels. Empty title is allowed; the caller resolves
 * the empty fallback ("Untitled") at render time.
 */
function RenameDraftModal({
  initialTitle,
  onSave,
  onClose,
}: {
  initialTitle: string
  onSave: (next: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialTitle)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const commit = () => {
    onSave(value)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-draft-title"
      data-testid="rename-draft-modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm px-4 pt-[20vh] animate-in fade-in duration-150"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4">
          <h2 id="rename-draft-title" className="text-base font-semibold text-warm-text dark:text-dark-text">
            Rename draft
          </h2>
          <p className="mt-1 text-xs text-warm-faint dark:text-dark-muted">
            Shown on the share card and in your Shares list.
          </p>
        </div>
        <div className="px-5 pb-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
            }}
            aria-label="Draft title"
            data-testid="rename-draft-input"
            className="w-full h-9 px-3 rounded border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-sm text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-muted focus:outline-none focus:ring-1 focus:ring-warm-border2 dark:focus:ring-dark-border2"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            data-testid="rename-draft-save"
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Confirm-delete modal for the editor. Replaces the older click-twice
 * in-place delete chip — for editor surfaces the user is about to
 * navigate away from the deleted thing, so an explicit modal with a
 * destructive button reads more clearly than a primed-pill confirm.
 * Chrome mirrors RenameDraftModal: warm-bg backdrop blur + warm-bg panel,
 * 440px max width. Esc + click-outside + Cancel close without deleting;
 * Enter (or clicking the focused Delete) confirms.
 */
function DeleteDraftModal({
  title,
  onConfirm,
  onClose,
}: {
  title: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const deleteRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    deleteRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-draft-title"
      data-testid="delete-draft-modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm px-4 pt-[20vh] animate-in fade-in duration-150"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4">
          <h2 id="delete-draft-title" className="text-base font-semibold text-warm-text dark:text-dark-text">
            Delete draft?
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-warm-muted dark:text-dark-muted">
            This will permanently remove “{title}” from your Shares. This cannot be undone —
            autosave is already off for this draft once you confirm.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            ref={deleteRef}
            type="button"
            data-testid="delete-draft-confirm"
            onClick={() => { void onConfirm() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void onConfirm()
              }
            }}
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-white bg-[color:var(--color-status-error)] dark:bg-[color:var(--color-status-error-dark)] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-status-error)]/40"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
