/**
 * Chrome cookie extraction for X/Twitter authentication.
 *
 * Adapted from fieldtheory-cli (https://github.com/afar1/fieldtheory-cli).
 * Reads Chrome's encrypted cookie database on macOS, decrypts auth_token and
 * ct0 (CSRF) cookies for x.com using the macOS Keychain.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, unlinkSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, platform, homedir } from 'node:os'
import { pbkdf2Sync, createDecipheriv, randomUUID } from 'node:crypto'
import type { CookiesCapability, Cookie, CookieQuery } from '@spool/connector-sdk'
import { SyncError, SyncErrorCode } from '@spool/connector-sdk'

function getMacOSChromeKey(): Buffer {
  const candidates = [
    { service: 'Chrome Safe Storage', account: 'Chrome' },
    { service: 'Chrome Safe Storage', account: 'Google Chrome' },
    { service: 'Google Chrome Safe Storage', account: 'Chrome' },
    { service: 'Google Chrome Safe Storage', account: 'Google Chrome' },
    { service: 'Chromium Safe Storage', account: 'Chromium' },
    { service: 'Brave Safe Storage', account: 'Brave' },
    { service: 'Brave Browser Safe Storage', account: 'Brave Browser' },
  ]

  for (const candidate of candidates) {
    try {
      const password = execFileSync(
        'security',
        ['find-generic-password', '-w', '-s', candidate.service, '-a', candidate.account],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim()
      if (password) {
        return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
      }
    } catch {
      // Try the next known browser/keychain naming pair.
    }
  }

  throw new SyncError(
    SyncErrorCode.AUTH_KEYCHAIN_DENIED,
    'Could not read a browser Safe Storage password from the macOS Keychain.',
  )
}

export function decryptCookieValue(encryptedValue: Buffer, key: Buffer, dbVersion = 0): string {
  if (encryptedValue.length === 0) return ''

  if (encryptedValue[0] === 0x76 && encryptedValue[1] === 0x31 && encryptedValue[2] === 0x30) {
    const iv = Buffer.alloc(16, 0x20) // 16 spaces
    const ciphertext = encryptedValue.subarray(3)
    const decipher = createDecipheriv('aes-128-cbc', key, iv)
    let decrypted = decipher.update(ciphertext)
    decrypted = Buffer.concat([decrypted, decipher.final()])

    // Chrome DB version >= 24 (Chrome ~130+) prepends SHA256(host_key) to plaintext
    if (dbVersion >= 24 && decrypted.length > 32) {
      decrypted = decrypted.subarray(32)
    }

    return decrypted.toString('utf8')
  }

  return encryptedValue.toString('utf8')
}

function detectChromeUserDataDir(): string {
  const os = platform()
  const home = homedir()
  if (os === 'darwin') return join(home, 'Library', 'Application Support', 'Google', 'Chrome')
  if (os === 'linux') return join(home, '.config', 'google-chrome')
  if (os === 'win32') return join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data')
  throw new SyncError(
    SyncErrorCode.AUTH_CHROME_NOT_FOUND,
    `Unsupported platform for Chrome cookie extraction: ${os}`,
  )
}

/**
 * Run a sqlite3 query with fallback to a temp copy (Chrome locks the DB while running).
 * Returns raw stdout string.
 */
function runSqliteQuery(dbPath: string, sql: string): string {
  const tryQuery = (path: string): string =>
    execFileSync('sqlite3', ['-json', path, sql], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim()

  try {
    return tryQuery(dbPath)
  } catch {
    const tmpDb = join(tmpdir(), `spool-cookies-${randomUUID()}.db`)
    try {
      copyFileSync(dbPath, tmpDb)
      return tryQuery(tmpDb)
    } catch (e2: unknown) {
      throw new SyncError(
        SyncErrorCode.AUTH_COOKIE_DECRYPT_FAILED,
        `Could not read Chrome Cookies database at ${dbPath}. ${e2 instanceof Error ? e2.message : ''}`,
        e2,
      )
    } finally {
      try { unlinkSync(tmpDb) } catch {}
    }
  }
}

// ── CookiesCapability wrapper ──────────────────────────────────────────────

interface RawCookieFull {
  name: string
  host_key: string
  path: string
  encrypted_value_hex: string
  value: string
  expires_utc: string
  is_secure: string
  is_httponly: string
}

/**
 * Enumerate every Chrome `host_key` value that should match a request to `host`
 * per RFC 6265 §5.1.3. Chrome stores host-only cookies under the bare hostname
 * and domain cookies under `.parent.example.com`; a request to `www.example.com`
 * must see cookies at `www.example.com`, `.www.example.com`, and `.example.com`
 * but not anything scoped to a sibling (`.other.example.com`) or a TLD alone.
 */
export function getMatchingHostKeys(host: string): string[] {
  const normalized = host.toLowerCase().replace(/^\./, '')
  if (!normalized || !normalized.includes('.')) return []

  const keys = [normalized, `.${normalized}`]
  let cur = normalized
  while (true) {
    const idx = cur.indexOf('.')
    if (idx < 0) break
    const parent = cur.substring(idx + 1)
    if (!parent.includes('.')) break
    keys.push(`.${parent}`)
    cur = parent
  }
  return keys
}

function queryAllCookiesForHost(
  dbPath: string,
  host: string,
): { cookies: RawCookieFull[]; dbVersion: number } {
  if (!existsSync(dbPath)) {
    throw new SyncError(
      SyncErrorCode.AUTH_CHROME_NOT_FOUND,
      `Chrome Cookies database not found at: ${dbPath}`,
    )
  }

  const keys = getMatchingHostKeys(host)
  if (keys.length === 0) return { cookies: [], dbVersion: 0 }

  const quoted = keys.map(k => `'${k.replace(/'/g, "''")}'`).join(',')
  // Fetch cookies and DB version in one sqlite3 invocation to avoid double process spawn
  const sql = `SELECT name, host_key, path, hex(encrypted_value) as encrypted_value_hex, value, expires_utc, is_secure, is_httponly, (SELECT value FROM meta WHERE key='version') as db_version FROM cookies WHERE host_key IN (${quoted});`

  const output = runSqliteQuery(dbPath, sql)

  if (!output || output === '[]') return { cookies: [], dbVersion: 0 }
  try {
    const rows: Array<RawCookieFull & { db_version?: string }> = JSON.parse(output)
    const dbVersion = rows.length > 0 ? parseInt(rows[0]?.db_version ?? '0', 10) || 0 : 0
    return { cookies: rows, dbVersion }
  } catch {
    return { cookies: [], dbVersion: 0 }
  }
}

const CHROMIUM_EPOCH_DELTA = 11644473600

function chromiumExpiresToUnix(expiresUtc: string | number): number | null {
  const raw = typeof expiresUtc === 'string' ? parseInt(expiresUtc, 10) : expiresUtc
  if (!raw || raw === 0) return null
  return raw / 1_000_000 - CHROMIUM_EPOCH_DELTA
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function makeChromeCookiesCapability(): CookiesCapability {
  return {
    async get(query: CookieQuery): Promise<Cookie[]> {
      if (query.browser !== 'chrome') {
        throw new SyncError(
          SyncErrorCode.AUTH_CHROME_NOT_FOUND,
          `Unsupported browser: ${query.browser}. Only 'chrome' is supported.`,
        )
      }

      const os = platform()
      if (os !== 'darwin') {
        throw new SyncError(
          SyncErrorCode.AUTH_CHROME_NOT_FOUND,
          `Direct cookie extraction is currently supported on macOS only (detected: ${os}).`,
        )
      }

      const profile = query.profile ?? 'Default'
      const dataDir = detectChromeUserDataDir()
      const dbPath = join(dataDir, profile, 'Cookies')
      const key = getMacOSChromeKey()

      const host = domainFromUrl(query.url)
      const result = queryAllCookiesForHost(dbPath, host)

      const cookies: Cookie[] = []
      for (const raw of result.cookies) {
        let value: string
        const hexVal = raw.encrypted_value_hex
        if (hexVal && hexVal.length > 0) {
          const buf = Buffer.from(hexVal, 'hex')
          const decrypted = decryptCookieValue(buf, key, result.dbVersion)
          value = decrypted.replace(/\0+$/g, '').trim()
        } else {
          value = raw.value ?? ''
        }

        cookies.push({
          name: raw.name,
          value,
          domain: raw.host_key,
          path: raw.path || '/',
          expires: chromiumExpiresToUnix(raw.expires_utc),
          secure: raw.is_secure === '1' || raw.is_secure === 'true',
          httpOnly: raw.is_httponly === '1' || raw.is_httponly === 'true',
        })
      }

      return cookies
    },
  }
}
