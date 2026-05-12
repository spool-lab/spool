/** Filesystem-safe but preserves CJK / Unicode letters. Only strips the
 *  characters that OSes genuinely can't have in filenames. */
export function sanitizeFilename(title: string): string {
  return title
    .trim()
    .replace(/[\/\\:*?"<>| -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim()
}
