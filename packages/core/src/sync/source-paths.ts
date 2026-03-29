import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join, relative, resolve } from 'node:path'

export type SessionSource = 'claude' | 'codex'

const SOURCE_DIR_NAMES: Record<SessionSource, string> = {
  claude: 'projects',
  codex: 'sessions',
}

const SOURCE_ENV_VARS: Record<SessionSource, string> = {
  claude: 'SPOOL_CLAUDE_DIR',
  codex: 'SPOOL_CODEX_DIR',
}

const SOURCE_DEFAULT_BASES: Record<SessionSource, string> = {
  claude: '.claude',
  codex: '.codex',
}

const SOURCE_PROFILE_BASES: Record<SessionSource, string> = {
  claude: '.claude-profiles',
  codex: '.codex-profiles',
}

export function getSessionRoots(source: SessionSource): string[] {
  const configured = process.env[SOURCE_ENV_VARS[source]]
  if (configured) {
    return dedupePaths(splitConfiguredPaths(configured).map(path => normalizeSourceRoot(source, path)))
  }

  const home = homedir()
  const childDir = SOURCE_DIR_NAMES[source]
  const roots = [join(home, SOURCE_DEFAULT_BASES[source], childDir)]
  const profilesBase = join(home, SOURCE_PROFILE_BASES[source])

  let entries: import('node:fs').Dirent<string>[] = []
  try {
    entries = readdirSync(profilesBase, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return roots
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    roots.push(join(profilesBase, entry.name, childDir))
  }

  return dedupePaths(roots)
}

export function detectSessionSource(
  filePath: string,
  sourceRoots: Record<SessionSource, string[]> = {
    claude: getSessionRoots('claude'),
    codex: getSessionRoots('codex'),
  },
): SessionSource | undefined {
  for (const source of ['claude', 'codex'] as const) {
    if (sourceRoots[source].some(root => isWithinRoot(filePath, root))) {
      return source
    }
  }
  return undefined
}

function splitConfiguredPaths(value: string): string[] {
  return value
    .split(/\r?\n/)
    .flatMap(part => part.split(delimiter))
    .map(part => part.trim())
    .filter(Boolean)
}

function normalizeSourceRoot(source: SessionSource, filePath: string): string {
  const resolvedPath = resolve(expandHome(filePath))
  const childDir = SOURCE_DIR_NAMES[source]
  if (basename(resolvedPath) === childDir) return resolvedPath

  const nestedPath = join(resolvedPath, childDir)
  return existsSync(nestedPath) ? nestedPath : resolvedPath
}

function expandHome(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2))
  return filePath
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(path => resolve(expandHome(path)))))
}

function isWithinRoot(filePath: string, root: string): boolean {
  const resolvedFile = resolve(filePath)
  const resolvedRoot = resolve(root)
  const rel = relative(resolvedRoot, resolvedFile)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
