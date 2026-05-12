export function formatRelativeDate(iso: string, opts?: { bucket?: string | undefined }): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfSessionDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const dayDiff = Math.round((startOfToday - startOfSessionDay) / 86400000)
    if (dayDiff <= 0) {
      const time = formatTime(d)
      return opts?.bucket === 'TODAY' ? time : `today, ${time}`
    }
    if (dayDiff === 1) {
      const time = formatTime(d)
      return opts?.bucket === 'YESTERDAY' ? time : `yesterday, ${time}`
    }
    if (d.getFullYear() === now.getFullYear()) {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d)
    }
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
  } catch {
    return iso.slice(0, 10)
  }
}

function formatTime(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}
