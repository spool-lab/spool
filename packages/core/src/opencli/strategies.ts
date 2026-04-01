/**
 * Platform sync strategies maintained by Spool.
 *
 * Each strategy tells Spool which opencli subcommand to run for a platform,
 * what extra args to pass, and how to label the source in the UI.
 * Only "list-type" commands that return collections without requiring
 * per-item arguments (like --url) belong here.
 */

import type { SyncMode, SyncPagination, SyncScheduling } from '../types.js'

export interface SyncStrategy {
  /** The opencli platform name (site) */
  platform: string
  /** The opencli subcommand to run */
  command: string
  /** Extra CLI args (e.g. --limit 100) */
  args?: string[]
  /** Human-readable label for the source */
  label: string
  /** Short description shown in the platform picker */
  description: string
  /**
   * Custom binary + args to use instead of `opencli <platform> <command>`.
   * When set, the manager spawns this directly and skips opencli.
   * The command must output JSON to stdout.
   */
  customExec?: { bin: string; args: string[] }

  // ── Universal Sync Strategy fields ──────────────────────────────────────

  /**
   * How this source should be synchronized.
   * - bidirectional: backfill + forward (bookmarks, stars, saves, marks)
   * - snapshot: replace on each fetch (trending, hot, feeds, timelines)
   * - append_only: forward only (notifications, history)
   */
  syncMode: SyncMode

  /** Pagination configuration (required for bidirectional & append_only) */
  pagination?: SyncPagination

  /** Scheduling overrides (optional — falls back to SYNC_DEFAULTS) */
  scheduling?: Partial<SyncScheduling>
}

/** Default scheduling parameters */
export const SYNC_DEFAULTS: SyncScheduling & { snapshotPollInterval: number; defaultPageSize: number; errorBackoffBase: number; forwardOverlapBuffer: number } = {
  /** Forward sync interval for bidirectional/append_only sources (seconds) */
  pollInterval: 15 * 60,          // 15 minutes
  /** Delay between backfill pages (seconds) */
  backfillInterval: 10,           // 10 seconds
  /** Max consecutive errors before pausing auto-sync */
  maxConsecutiveErrors: 5,
  /** Forward sync interval for snapshot sources (seconds) */
  snapshotPollInterval: 60 * 60,  // 1 hour
  /** Default items per page */
  defaultPageSize: 50,
  /** Base backoff delay on error (seconds) */
  errorBackoffBase: 60,
  /** Extra items to fetch past cursor for overlap safety */
  forwardOverlapBuffer: 5,
}

/**
 * Built-in sync strategies. Each entry is a known-good command that
 * returns a collection of items suitable for indexing.
 */
export const SYNC_STRATEGIES: SyncStrategy[] = [
  // ── Twitter / X ────────────────────────────────────────────────
  {
    platform: 'twitter',
    command: 'bookmarks',
    args: ['--limit', '100'],
    label: 'X Bookmarks',
    description: 'Your saved tweets on X',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 100, cursorArg: '--cursor', limitArg: '--limit' },
  },
  {
    platform: 'twitter',
    command: 'timeline',
    label: 'X Timeline',
    description: 'Your home timeline on X',
    syncMode: 'snapshot',
  },
  {
    platform: 'twitter',
    command: 'notifications',
    label: 'X Notifications',
    description: 'Your recent notifications on X',
    syncMode: 'append_only',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'twitter',
    command: 'following',
    label: 'X Following',
    description: 'Accounts you follow on X',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },

  // ── Hacker News ────────────────────────────────────────────────
  {
    platform: 'hackernews',
    command: 'top',
    label: 'HN Top Stories',
    description: 'Current top stories on Hacker News',
    syncMode: 'snapshot',
  },
  {
    platform: 'hackernews',
    command: 'best',
    label: 'HN Best Stories',
    description: 'Best stories on Hacker News',
    syncMode: 'snapshot',
  },
  {
    platform: 'hackernews',
    command: 'new',
    label: 'HN New Stories',
    description: 'Newest stories on Hacker News',
    syncMode: 'snapshot',
  },
  {
    platform: 'hackernews',
    command: 'show',
    label: 'HN Show',
    description: 'Show HN posts',
    syncMode: 'snapshot',
  },
  {
    platform: 'hackernews',
    command: 'ask',
    label: 'HN Ask',
    description: 'Ask HN posts',
    syncMode: 'snapshot',
  },
  {
    platform: 'hackernews',
    command: 'jobs',
    label: 'HN Jobs',
    description: 'Hacker News job postings',
    syncMode: 'snapshot',
  },

  // ── Reddit ─────────────────────────────────────────────────────
  {
    platform: 'reddit',
    command: 'hot',
    label: 'Reddit Hot',
    description: 'Hot posts from your subscriptions',
    syncMode: 'snapshot',
  },
  {
    platform: 'reddit',
    command: 'saved',
    label: 'Reddit Saved',
    description: 'Your saved Reddit posts',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50, cursorArg: '--after' },
  },
  {
    platform: 'reddit',
    command: 'upvoted',
    label: 'Reddit Upvoted',
    description: 'Posts you upvoted on Reddit',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50, cursorArg: '--after' },
  },
  {
    platform: 'reddit',
    command: 'frontpage',
    label: 'Reddit Frontpage',
    description: 'Reddit frontpage / r/all',
    syncMode: 'snapshot',
  },
  {
    platform: 'reddit',
    command: 'popular',
    label: 'Reddit Popular',
    description: 'Popular posts on Reddit',
    syncMode: 'snapshot',
  },

  // ── YouTube ────────────────────────────────────────────────────
  {
    platform: 'youtube',
    command: 'subscriptions',
    label: 'YouTube Subscriptions',
    description: 'Recent videos from your subscriptions',
    syncMode: 'snapshot',
  },

  // ── GitHub ─────────────────────────────────────────────────────
  {
    platform: 'github',
    command: 'stars',
    label: 'GitHub Stars',
    description: 'Repos you recently starred on GitHub',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 100 },
    customExec: {
      bin: 'gh',
      args: ['api', '/user/starred?per_page=100', '-H', 'Accept: application/vnd.github.v3.star+json'],
    },
  },
  {
    platform: 'gh',
    command: 'notifications',
    label: 'GitHub Notifications',
    description: 'Your GitHub notifications',
    syncMode: 'append_only',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },

  // ── Bilibili ───────────────────────────────────────────────────
  {
    platform: 'bilibili',
    command: 'favorite',
    label: 'Bilibili Favorites',
    description: 'Your default favorites on Bilibili',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'bilibili',
    command: 'history',
    label: 'Bilibili History',
    description: 'Your watch history on Bilibili',
    syncMode: 'append_only',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'bilibili',
    command: 'feed',
    label: 'Bilibili Feed',
    description: 'Timeline from accounts you follow',
    syncMode: 'snapshot',
  },
  {
    platform: 'bilibili',
    command: 'dynamic',
    label: 'Bilibili Dynamic',
    description: 'Your dynamic feed on Bilibili',
    syncMode: 'snapshot',
  },
  {
    platform: 'bilibili',
    command: 'hot',
    label: 'Bilibili Hot',
    description: 'Trending videos on Bilibili',
    syncMode: 'snapshot',
  },
  {
    platform: 'bilibili',
    command: 'ranking',
    label: 'Bilibili Ranking',
    description: 'Video ranking board on Bilibili',
    syncMode: 'snapshot',
  },

  // ── Weibo ──────────────────────────────────────────────────────
  {
    platform: 'weibo',
    command: 'feed',
    label: 'Weibo Feed',
    description: 'Posts from accounts you follow',
    syncMode: 'snapshot',
  },
  {
    platform: 'weibo',
    command: 'hot',
    label: 'Weibo Hot',
    description: 'Trending topics on Weibo',
    syncMode: 'snapshot',
  },

  // ── Xiaohongshu ────────────────────────────────────────────────
  {
    platform: 'xiaohongshu',
    command: 'feed',
    label: 'Xiaohongshu Feed',
    description: 'Recommended posts on Xiaohongshu',
    syncMode: 'snapshot',
  },
  {
    platform: 'xiaohongshu',
    command: 'notifications',
    label: 'Xiaohongshu Notifications',
    description: 'Your notifications on Xiaohongshu',
    syncMode: 'append_only',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'xiaohongshu',
    command: 'creator-notes',
    label: 'Xiaohongshu My Notes',
    description: 'Your published notes with stats',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },

  // ── Zhihu ──────────────────────────────────────────────────────
  {
    platform: 'zhihu',
    command: 'hot',
    label: 'Zhihu Hot',
    description: 'Trending topics on Zhihu',
    syncMode: 'snapshot',
  },

  // ── Douban ─────────────────────────────────────────────────────
  {
    platform: 'douban',
    command: 'marks',
    label: 'Douban Marks',
    description: 'Your movie/book marks on Douban',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'douban',
    command: 'reviews',
    label: 'Douban Reviews',
    description: 'Your reviews on Douban',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'douban',
    command: 'movie-hot',
    label: 'Douban Hot Movies',
    description: 'Trending movies on Douban',
    syncMode: 'snapshot',
  },
  {
    platform: 'douban',
    command: 'book-hot',
    label: 'Douban Hot Books',
    description: 'Trending books on Douban',
    syncMode: 'snapshot',
  },
  {
    platform: 'douban',
    command: 'top250',
    label: 'Douban Top 250',
    description: 'Douban top 250 movies',
    syncMode: 'snapshot',
  },

  // ── Substack ───────────────────────────────────────────────────
  {
    platform: 'substack',
    command: 'feed',
    label: 'Substack Feed',
    description: 'Trending articles on Substack',
    syncMode: 'snapshot',
  },

  // ── Medium ─────────────────────────────────────────────────────
  {
    platform: 'medium',
    command: 'feed',
    label: 'Medium Feed',
    description: 'Trending articles on Medium',
    syncMode: 'snapshot',
  },

  // ── LinkedIn ───────────────────────────────────────────────────
  {
    platform: 'linkedin',
    command: 'timeline',
    label: 'LinkedIn Timeline',
    description: 'Your LinkedIn home feed',
    syncMode: 'snapshot',
  },

  // ── Instagram ──────────────────────────────────────────────────
  {
    platform: 'instagram',
    command: 'saved',
    label: 'Instagram Saved',
    description: 'Your saved posts on Instagram',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'instagram',
    command: 'explore',
    label: 'Instagram Explore',
    description: 'Trending posts on Instagram',
    syncMode: 'snapshot',
  },

  // ── Facebook ───────────────────────────────────────────────────
  {
    platform: 'facebook',
    command: 'feed',
    label: 'Facebook Feed',
    description: 'Your Facebook news feed',
    syncMode: 'snapshot',
  },
  {
    platform: 'facebook',
    command: 'notifications',
    label: 'Facebook Notifications',
    description: 'Your recent Facebook notifications',
    syncMode: 'append_only',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'facebook',
    command: 'groups',
    label: 'Facebook Groups',
    description: 'Your Facebook groups',
    syncMode: 'snapshot',
  },

  // ── Notion ─────────────────────────────────────────────────────
  {
    platform: 'notion',
    command: 'favorites',
    label: 'Notion Favorites',
    description: 'Your favorited pages in Notion',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'notion',
    command: 'sidebar',
    label: 'Notion Sidebar',
    description: 'Pages and databases in your Notion sidebar',
    syncMode: 'snapshot',
  },

  // ── Jike ───────────────────────────────────────────────────────
  {
    platform: 'jike',
    command: 'feed',
    label: 'Jike Feed',
    description: 'Your Jike home feed',
    syncMode: 'snapshot',
  },
  {
    platform: 'jike',
    command: 'notifications',
    label: 'Jike Notifications',
    description: 'Your Jike notifications',
    syncMode: 'append_only',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },

  // ── TikTok ─────────────────────────────────────────────────────
  {
    platform: 'tiktok',
    command: 'explore',
    label: 'TikTok Explore',
    description: 'Trending videos on TikTok',
    syncMode: 'snapshot',
  },
  {
    platform: 'tiktok',
    command: 'following',
    label: 'TikTok Following',
    description: 'Accounts you follow on TikTok',
    syncMode: 'snapshot',
  },
  {
    platform: 'tiktok',
    command: 'notifications',
    label: 'TikTok Notifications',
    description: 'Your TikTok notifications',
    syncMode: 'append_only',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },

  // ── Douyin ─────────────────────────────────────────────────────
  {
    platform: 'douyin',
    command: 'videos',
    label: 'Douyin Videos',
    description: 'Your published videos on Douyin',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },
  {
    platform: 'douyin',
    command: 'collections',
    label: 'Douyin Collections',
    description: 'Your video collections on Douyin',
    syncMode: 'bidirectional',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },

  // ── V2EX ───────────────────────────────────────────────────────
  {
    platform: 'v2ex',
    command: 'hot',
    label: 'V2EX Hot',
    description: 'Hot topics on V2EX',
    syncMode: 'snapshot',
  },
  {
    platform: 'v2ex',
    command: 'latest',
    label: 'V2EX Latest',
    description: 'Latest topics on V2EX',
    syncMode: 'snapshot',
  },
  {
    platform: 'v2ex',
    command: 'notifications',
    label: 'V2EX Notifications',
    description: 'Your V2EX notifications',
    syncMode: 'append_only',
    pagination: { cursorField: 'platform_id', order: 'newest_first', pageSize: 50 },
  },

  // ── DEV.to ─────────────────────────────────────────────────────
  {
    platform: 'devto',
    command: 'top',
    label: 'DEV.to Top',
    description: 'Top articles on DEV.to today',
    syncMode: 'snapshot',
  },

  // ── Lobsters ───────────────────────────────────────────────────
  {
    platform: 'lobsters',
    command: 'hot',
    label: 'Lobsters Hot',
    description: 'Hottest stories on Lobsters',
    syncMode: 'snapshot',
  },
  {
    platform: 'lobsters',
    command: 'newest',
    label: 'Lobsters New',
    description: 'Newest stories on Lobsters',
    syncMode: 'snapshot',
  },

  // ── Stack Overflow ─────────────────────────────────────────────
  {
    platform: 'stackoverflow',
    command: 'hot',
    label: 'Stack Overflow Hot',
    description: 'Hot questions on Stack Overflow',
    syncMode: 'snapshot',
  },

  // ── Wikipedia ──────────────────────────────────────────────────
  {
    platform: 'wikipedia',
    command: 'trending',
    label: 'Wikipedia Trending',
    description: 'Most-read articles on Wikipedia',
    syncMode: 'snapshot',
  },

  // ── Steam ──────────────────────────────────────────────────────
  {
    platform: 'steam',
    command: 'top-sellers',
    label: 'Steam Top Sellers',
    description: 'Top selling games on Steam',
    syncMode: 'snapshot',
  },
]

/** Get all strategies for a given platform */
export function getStrategiesForPlatform(platform: string): SyncStrategy[] {
  return SYNC_STRATEGIES.filter(s => s.platform === platform)
}

/** Get a specific strategy */
export function getStrategy(platform: string, command: string): SyncStrategy | undefined {
  return SYNC_STRATEGIES.find(s => s.platform === platform && s.command === command)
}

/** Get all unique platforms that have strategies */
export function getStrategyPlatforms(): string[] {
  return [...new Set(SYNC_STRATEGIES.map(s => s.platform))]
}
