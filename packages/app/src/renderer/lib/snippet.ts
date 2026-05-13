/** Rewrites `<mark>` tags from core's buildLikeSnippet to `<strong>`
 *  so renderer surfaces can style highlights via their own `<strong>`
 *  rules (accent color, font weight, etc.) without each surface
 *  carrying the same regex. */
export function snippetToStrongHtml(snippet: string): string {
  return snippet.replace(/<mark>/g, '<strong>').replace(/<\/mark>/g, '</strong>')
}
