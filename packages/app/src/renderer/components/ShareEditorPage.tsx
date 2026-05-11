import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Download } from 'lucide-react'
import {
  TemplateRender,
  DEFAULT_OPTS,
  TEMPLATE_RATIO,
  buildSpoolDocument,
  openSaveSlot,
  writeToSlot,
  rasterizeToPngBlob,
  PngTooTallError,
  installPdfPrintHost,
  filenameForExport,
  type Conversation,
  type EditorOpts,
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
  const [toast, setToast] = useState<string | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string } | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)

  // Revoke the in-memory blob: URL when the preview modal closes so we
  // don't leak the PDF buffer for the rest of the session.
  useEffect(() => {
    if (!pdfPreview) return
    return () => URL.revokeObjectURL(pdfPreview.url)
  }, [pdfPreview])

  const meta = useMemo(() => {
    const wordLabel = `${conversation.wordCount.toLocaleString()} ${conversation.wordCount === 1 ? 'word' : 'words'}`
    return [conversation.sourceLabel, conversation.createdAt, wordLabel, `~${conversation.readMin} min read`].join(' · ')
  }, [conversation])

  // Auto-dismiss the toast after a few seconds.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(id)
  }, [toast])

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
      setToast(`Saved ${filename}`)
    } catch (err) {
      console.error('Export to PNG failed:', err)
      setSaveState('error')
      if (err instanceof PngTooTallError) {
        setToast('Conversation too tall for PNG — try PDF export.')
      } else {
        setToast('Export failed — see console for details')
      }
    }
  }, [beginSaving, conversation, opts.template])

  const exportPdf = useCallback(async () => {
    const node = previewRef.current
    if (!node) return
    await beginSaving()
    // Install the print host BEFORE calling into main — printToPDF
    // captures the renderer's current page state, which means the
    // @media print stylesheet has to be live first.
    const width = TEMPLATE_RATIO[opts.template].w
    const height = node.scrollHeight
    const host = installPdfPrintHost(node, conversation, opts.template, { width, height })
    try {
      const bytes = await window.spool.printToPdf(host.widthPx, host.heightPx)
      // Open in our own preview modal — no OS print dialog. The user
      // gets a vector PDF preview before deciding to save.
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setPdfPreview({ url, filename: host.filename })
      setSaveState('idle')
    } catch (err) {
      console.error('Export to PDF failed:', err)
      setSaveState('error')
      setToast('Export failed — see console for details')
    } finally {
      host.cleanup()
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
    setToast(`Saved ${pdfPreview.filename}`)
    setPdfPreview(null)
  }, [pdfPreview])

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
      setToast(`Saved ${filename}`)
    } catch (err) {
      console.error('Export to .spool failed:', err)
      setSaveState('error')
      setToast('Export failed — see console for details')
    }
  }, [beginSaving, conversation, opts])

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
              { label: 'Save as image (PNG)', onSelect: () => { void exportPng() } },
              { label: 'Save as PDF', onSelect: () => { void exportPdf() } },
              { label: 'Save as .spool file', onSelect: () => { void exportSpoolFile() } },
            ]}
          />
        </div>
      </header>

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-md text-[12px] text-white bg-warm-text/95 dark:bg-dark-surface2/95 shadow-lg backdrop-blur-sm"
        >
          {toast}
        </div>
      )}

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
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-warm-accent dark:bg-dark-accent hover:opacity-90 transition-opacity"
              >
                <Download size={12} strokeWidth={1.8} />
                Save PDF
              </button>
            </div>
            <iframe src={pdfPreview.url} title="PDF preview" className="flex-1 w-full border-0 bg-white" />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto bg-warm-bg dark:bg-dark-bg">
        <div className="flex justify-center px-6 py-6">
          {/* Outer wrapper carries the framing (shadow / rounded corners /
              overflow) but is NOT the export target — the rasterizer and
              the print-host need to read the raw template's intrinsic
              dimensions without our visual chrome interfering with
              clientWidth / scrollHeight.
              The inner div has an explicit width matching the template's
              natural ratio so html-to-image rasterizes at the right size
              regardless of how flex centering sized its parent. */}
          <div className="shadow-lg rounded-sm overflow-hidden">
            <div ref={previewRef} style={{ width: TEMPLATE_RATIO[opts.template].w }}>
              <TemplateRender template={opts.template} convo={conversation} opts={opts} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
