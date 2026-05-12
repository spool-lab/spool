import { useCallback, useEffect, useState } from 'react'
import type { ShareDraftListItem } from '@spool-lab/core'

interface UseShareDraftsResult {
  drafts: ShareDraftListItem[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Reads the local share_drafts table via the preload bridge. Light: no
 * push notification yet, so callers refresh after a known-to-mutate
 * action (editor autosave, delete, etc.). PR 3 will revisit this once
 * the editor exists and we can decide whether to push a "draft changed"
 * IPC event vs. just refetch on focus.
 */
export function useShareDrafts(opts: { limit?: number } = {}): UseShareDraftsResult {
  const [drafts, setDrafts] = useState<ShareDraftListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await window.spool.shareDraft.list(opts.limit)
      setDrafts(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [opts.limit])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { drafts, loading, error, refresh }
}
