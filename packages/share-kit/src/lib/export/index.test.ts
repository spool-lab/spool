import { describe, it, expect } from 'vitest'
import { pdfPrintCss } from './index'

/**
 * Print-CSS regression tests.
 *
 * The PDF export crashes silently in subtle ways when the @media
 * print rules drift — content lands off-center, body width leaks
 * through from the on-screen viewport, or @page rules race with the
 * main process's pageSize option. We can't easily render a real PDF
 * in a unit test (no Chromium in vitest's node env), so we lock down
 * the CSS string instead: any change to the rules must update these
 * assertions explicitly.
 */
describe('pdfPrintCss', () => {
  const css = pdfPrintCss(720)

  it('embeds the requested template width with !important', () => {
    expect(css).toContain('width: 720px !important')
  })

  it('embeds the width verbatim, no rounding or scaling', () => {
    expect(pdfPrintCss(640)).toContain('width: 640px !important')
    expect(pdfPrintCss(1080)).toContain('width: 1080px !important')
  })

  it('hides all body children except the print host during print', () => {
    expect(css).toContain('body > *:not(.spool-print-host) { display: none !important; }')
  })

  it('pins body to A4 width (default) so margin auto on host lands on page center', () => {
    // Critical: without an explicit body width, Chromium's print
    // viewport (often larger than the actual A4 page) becomes the
    // containing block. The host then centers in the LARGER viewport
    // and the PDF page-fit lands off-center. Pinning body to 794px
    // (A4 at 96dpi) keeps centering deterministic.
    expect(css).toMatch(/html,\s*body\s*\{[^}]*width:\s*794px\s*!important/)
    expect(css).toMatch(/html,\s*body\s*\{[^}]*max-width:\s*794px\s*!important/)
  })

  it('allows a custom page width override', () => {
    const usLetterCss = pdfPrintCss(720, 816)
    expect(usLetterCss).toMatch(/html,\s*body\s*\{[^}]*width:\s*816px\s*!important/)
  })

  it('centers the host on the page with margin auto + static positioning', () => {
    expect(css).toContain('position: static !important')
    expect(css).toContain('margin: 0 auto !important')
  })

  it('overrides the screen-time `position: fixed; left: -100000px` parking', () => {
    // installPdfPrintHost parks the host offscreen at install time
    // via inline style. The print CSS must reset both, otherwise the
    // host stays at left: -100000px during print and nothing shows.
    expect(css).toContain('position: static !important')
    expect(css).toContain('left: auto !important')
  })

  it('strips the on-screen shadow on the cloned artifact', () => {
    expect(css).toContain('box-shadow: none !important')
  })

  it('lets the cloned artifact fill the host width', () => {
    expect(css).toMatch(/\.spool-print-host\s*>\s*\*\s*\{[^}]*width:\s*100%\s*!important/)
  })

  it('asks Chromium to keep message bubbles whole across page breaks', () => {
    expect(css).toContain('break-inside: avoid !important')
    expect(css).toContain('page-break-inside: avoid !important')
  })

  it('does NOT set a custom @page size — main process owns page dimensions', () => {
    // If we set @page { size: ... } here, it races with the
    // pageSize: 'A4' option passed to webContents.printToPDF and
    // results in weird page splits.
    expect(css).not.toMatch(/@page\s*\{[^}]*size:/)
  })

  it('wraps everything inside @media print so on-screen layout is unaffected', () => {
    expect(css.trim().startsWith('@media print')).toBe(true)
  })
})
