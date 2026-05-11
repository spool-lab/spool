// Local export pipeline — 100% in-browser. Never uploads.
//
// PNG: DOM → html-to-image → PNG blob → save.
// PDF: clone the artifact into a print-only host and call window.print().
//      The browser's Save-as-PDF path keeps text as real text (selectable,
//      searchable, copyable), which embedding a PNG into pdf-lib cannot.
//
// (Markdown export was intentionally dropped from this port; MD cannot
//  faithfully carry tool calls, redaction overlays, or audit chips.
//  Revisit in a later phase if real demand surfaces.)
//
// Save UX: when the browser supports File System Access API
// (`showSaveFilePicker`), we surface a native save dialog so the user
// can pick the folder and rename the file inline. Browsers without
// it (Safari, Firefox) fall back to the classic `<a download>` path
// that drops into the default Downloads folder. PDF gets the same
// UX via the browser's Save-as-PDF dialog inside window.print().

import { toBlob } from 'html-to-image'
import type { Conversation, Template } from '@/lib/types'
import { sanitizeFilename } from '@/lib/filename'

export type ExportFormat = 'png' | 'pdf'

interface ExportArgs {
  /** The full-size (unscaled) DOM node containing the rendered template. */
  node: HTMLElement
  template: Template
  conversation: Conversation
}

export async function exportArtifact(format: ExportFormat, args: ExportArgs): Promise<void> {
  await document.fonts.ready

  switch (format) {
    case 'png':
      return exportPng(args)
    case 'pdf':
      return exportPdf(args)
  }
}

async function exportPng({ node, template, conversation }: ExportArgs): Promise<void> {
  // 3× pixel ratio keeps text crisp on retina phones where these
  // get posted most often.
  const blob = await renderBlob(node, 3)
  await saveBlob(blob, filenameFor(conversation, template, 'png'), {
    description: 'PNG image',
    mime: 'image/png',
    ext: '.png',
  })
}

/**
 * Wrap `html-to-image`'s `toBlob` with a safeguard: we skip its
 * web-font inlining step because browsers block `cssRules` access on
 * cross-origin stylesheets (including Fontsource's subset splits).
 * Our fonts are preloaded via @font-face in global.css, so the canvas
 * renderer has them available without re-embedding.
 */
async function renderBlob(node: HTMLElement, pixelRatio: number): Promise<Blob> {
  const blob = await toBlob(node, { pixelRatio, cacheBust: true, skipFonts: true })
  if (!blob) throw new Error('Failed to rasterize artifact — browser returned no blob.')
  return blob
}

/**
 * Real vector PDF via the browser's print-to-PDF pipeline.
 *
 * We clone the full-size artifact into a hidden "print host" on the
 * current page, add a print-only stylesheet that:
 *   • hides everything except the host
 *   • un-positions it (override `left: -100000px`)
 *   • sets @page to match the artifact's actual dimensions
 * then call `window.print()`. The user gets a print dialog where
 * "Save as PDF" produces a vector PDF with selectable text — and the
 * dialog itself lets them rename and choose where to save.
 *
 * Setting `document.title` before printing makes Chrome default the
 * saved filename to our desired one (well-known UX hack).
 */
async function exportPdf({ node, template, conversation }: ExportArgs): Promise<void> {
  const width = node.clientWidth
  const height = node.scrollHeight

  // Clone the artifact and mount it in a print host that only becomes
  // visible inside @media print.
  const host = document.createElement('div')
  host.className = 'spool-print-host'
  host.style.cssText = 'position:fixed;left:-100000px;top:0;'
  host.appendChild(node.cloneNode(true) as HTMLElement)
  document.body.appendChild(host)

  const style = document.createElement('style')
  style.setAttribute('data-spool-print', '')
  style.textContent = `
    @media print {
      body > *:not(.spool-print-host) { display: none !important; }
      body { background: white !important; }
      .spool-print-host {
        position: static !important;
        left: auto !important;
        top: auto !important;
        width: auto !important;
      }
      .spool-print-host > * {
        box-shadow: none !important;
      }
      @page {
        size: ${width}px ${height}px;
        margin: 0;
      }
    }
  `
  document.head.appendChild(style)

  const origTitle = document.title
  document.title = filenameFor(conversation, template, 'pdf')

  const cleanup = () => {
    document.body.removeChild(host)
    document.head.removeChild(style)
    document.title = origTitle
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)

  // Let layout settle + fonts paint into the cloned node.
  await document.fonts.ready
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  window.print()
}

/**
 * Save a Blob to disk. Prefers the File System Access API so the user
 * gets a native Save dialog (pick folder, rename inline). Falls back
 * to an `<a download>` click on browsers without the API.
 *
 * User cancellation (AbortError from the picker) is silent — it means
 * they closed the dialog on purpose, not a failure.
 */
export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  accept: { description: string; mime: string; ext: string },
): Promise<void> {
  const picker = (window as unknown as {
    showSaveFilePicker?: (opts: {
      suggestedName: string
      types: Array<{ description: string; accept: Record<string, string[]> }>
    }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>
  }).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [
          {
            description: accept.description,
            accept: { [accept.mime]: [accept.ext] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (err) {
      // User cancelled the native dialog — silent return.
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Anything else (SecurityError from a user-gesture timeout after a
      // long rasterization, NotAllowedError on locked-down embeddings,
      // unknown picker failures) falls through to the <a download>
      // fallback below — the user clicked Export and expects a file,
      // not a console-only failure. Log for visibility but keep going.
      console.warn('[share-kit] File System Access save failed, falling back to <a download>:', err)
    }
  }

  // Fallback: classic invisible-link click. Lands in Downloads.
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = suggestedName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Ext = 'png' | 'pdf'

function filenameFor(c: Conversation, template: Template, ext: Ext): string {
  const safe = sanitizeFilename(c.title)
  const date = new Date().toISOString().slice(0, 10)
  const templateTag = template === 'chat' ? '' : ` · ${template}`
  return `${safe || 'spool'}${templateTag} · ${date}.${ext}`
}
