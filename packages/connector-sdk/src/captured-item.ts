/**
 * Canonical data unit flowing through the connector system.
 * Every item a connector produces and every item stored in Spool's DB
 * starts as a CapturedItem.
 */
export interface CapturedItem {
  /** Original URL on the source platform. */
  url: string
  /** Display title (truncated for long content). */
  title: string
  /** Full text content of the item. */
  contentText: string
  /** Author handle or name. null if unknown. */
  author: string | null
  /** Platform identifier: 'twitter', 'github', 'reddit', etc. */
  platform: string
  /** Platform-specific unique ID used for dedup. null = no stable ID. */
  platformId: string | null
  /** Content type for rendering: 'tweet', 'repo', 'video', 'post', 'page'. */
  contentType: string
  /** Preview image URL. null if none. */
  thumbnailUrl: string | null
  /** Extensible bag for platform-specific structured data. */
  metadata: Record<string, unknown>
  /** When the item was created on the platform (ISO 8601). */
  capturedAt: string
  /** Raw API response for future re-parsing. null to skip storing raw. */
  rawJson: string | null
}
