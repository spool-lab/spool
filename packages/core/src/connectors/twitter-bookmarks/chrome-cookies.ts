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
import { SyncError, SyncErrorCode } from '../types.js'

export interface ChromeCookieResult {
  csrfToken: string
  cookieHeader: string
}

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

function sanitizeCookieValue(name: string, value: string): string {
  const cleaned = value.replace(/\0+$/g, '').trim()
  if (!cleaned) {
    throw new SyncError(
      SyncErrorCode.AUTH_COOKIE_DECRYPT_FAILED,
      `Cookie ${name} was empty after decryption. Try closing Chrome completely and retrying.`,
    )
  }
  if (!/^[\x21-\x7E]+$/.test(cleaned)) {
    throw new SyncError(
      SyncErrorCode.AUTH_COOKIE_DECRYPT_FAILED,
      `Could not decrypt the ${name} cookie. Try closing Chrome or using a different profile.`,
    )
  }
  return cleaned
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

interface RawCookie {
  name: string
  host_key: string
  encrypted_value_hex: string
  value: string
}

function queryDbVersion(dbPath: string): number {
  const tryQuery = (p: string) =>
    execFileSync('sqlite3', [p, "SELECT value FROM meta WHERE key='version';"], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }).trim()

  try {
    return parseInt(tryQuery(dbPath), 10) || 0
  } catch {
    const tmpDb = join(tmpdir(), `spool-meta-${randomUUID()}.db`)
    try {
      copyFileSync(dbPath, tmpDb)
      return parseInt(tryQuery(tmpDb), 10) || 0
    } catch {
      return 0
    } finally {
      try { unlinkSync(tmpDb) } catch {}
    }
  }
}

function queryCookies(
  dbPath: string,
  domain: string,
  names: string[],
): { cookies: RawCookie[]; dbVersion: number } {
  if (!existsSync(dbPath)) {
    throw new SyncError(
      SyncErrorCode.AUTH_CHROME_NOT_FOUND,
      `Chrome Cookies database not found at: ${dbPath}`,
    )
  }

  const safeDomain = domain.replace(/'/g, "''")
  const nameList = names.map(n => `'${n.replace(/'/g, "''")}'`).join(',')
  const sql = `SELECT name, host_key, hex(encrypted_value) as encrypted_value_hex, value FROM cookies WHERE host_key LIKE '%${safeDomain}' AND name IN (${nameList});`

  const tryQuery = (path: string): string =>
    execFileSync('sqlite3', ['-json', path, sql], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim()

  let output: string
  try {
    output = tryQuery(dbPath)
  } catch {
    const tmpDb = join(tmpdir(), `spool-cookies-${randomUUID()}.db`)
    try {
      copyFileSync(dbPath, tmpDb)
      output = tryQuery(tmpDb)
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

  const dbVersion = queryDbVersion(dbPath)

  if (!output || output === '[]') return { cookies: [], dbVersion }
  try {
    return { cookies: JSON.parse(output), dbVersion }
  } catch {
    return { cookies: [], dbVersion }
  }
}

/** Detect the default Chrome user-data directory for the current OS. */
export function detectChromeUserDataDir(): string {
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

export function extractChromeXCookies(
  chromeUserDataDir?: string,
  profileDirectory = 'Default',
): ChromeCookieResult {
  const os = platform()
  if (os !== 'darwin') {
    throw new SyncError(
      SyncErrorCode.AUTH_CHROME_NOT_FOUND,
      `Direct cookie extraction is currently supported on macOS only (detected: ${os}).`,
    )
  }

  const dataDir = chromeUserDataDir ?? detectChromeUserDataDir()
  const dbPath = join(dataDir, profileDirectory, 'Cookies')
  const key = getMacOSChromeKey()

  let result = queryCookies(dbPath, '.x.com', ['ct0', 'auth_token'])
  if (result.cookies.length === 0) {
    result = queryCookies(dbPath, '.twitter.com', ['ct0', 'auth_token'])
  }

  const decrypted = new Map<string, string>()
  for (const cookie of result.cookies) {
    const hexVal = cookie.encrypted_value_hex
    if (hexVal && hexVal.length > 0) {
      const buf = Buffer.from(hexVal, 'hex')
      decrypted.set(cookie.name, decryptCookieValue(buf, key, result.dbVersion))
    } else if (cookie.value) {
      decrypted.set(cookie.name, cookie.value)
    }
  }

  const ct0 = decrypted.get('ct0')
  const authToken = decrypted.get('auth_token')

  if (!ct0) {
    throw new SyncError(
      SyncErrorCode.AUTH_NOT_LOGGED_IN,
      `No ct0 CSRF cookie found for x.com in Chrome (profile: "${profileDirectory}"). Log into X in Chrome and retry.`,
    )
  }

  const cookieParts = [`ct0=${sanitizeCookieValue('ct0', ct0)}`]
  if (authToken) cookieParts.push(`auth_token=${sanitizeCookieValue('auth_token', authToken)}`)
  const cookieHeader = cookieParts.join('; ')

  return { csrfToken: sanitizeCookieValue('ct0', ct0), cookieHeader }
}
