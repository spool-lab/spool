import type { DirectoryGroup } from '@spool-lab/core'

export interface DirNode {
  name: string        // segment label shown in UI
  fullPath: string    // absolute path of this node
  dir: DirectoryGroup | null  // non-null only for leaf nodes with sessions
  children: DirNode[]
  totalSessions: number
}

export function buildDirTree(dirs: DirectoryGroup[]): DirNode[] {
  if (dirs.length === 0) return []

  const prefix = commonPrefix(dirs.map(d => d.displayPath))

  const root: DirNode = { name: '', fullPath: prefix, dir: null, children: [], totalSessions: 0 }

  for (const dir of dirs) {
    const relative = dir.displayPath.slice(prefix.length).replace(/^\//, '')
    const segments = relative.split('/').filter(Boolean)
    insert(root, segments, dir, prefix)
  }

  propagateCounts(root)
  return root.children
}

function insert(node: DirNode, segments: string[], dir: DirectoryGroup, parentPath: string) {
  if (segments.length === 0) {
    node.dir = dir
    return
  }
  const head = segments[0]!
  const rest = segments.slice(1)
  const fullPath = parentPath ? `${parentPath}/${head}` : head
  let child = node.children.find(c => c.name === head)
  if (!child) {
    child = { name: head, fullPath, dir: null, children: [], totalSessions: 0 }
    node.children.push(child)
  }
  insert(child, rest, dir, fullPath)
}

function propagateCounts(node: DirNode): number {
  const own = node.dir?.sessionCount ?? 0
  const childSum = node.children.reduce((s, c) => s + propagateCounts(c), 0)
  node.totalSessions = own + childSum
  return node.totalSessions
}

function commonPrefix(paths: string[]): string {
  if (paths.length === 0) return ''
  const parts = paths[0]!.split('/')
  let prefix = ''
  for (let i = 0; i < parts.length; i++) {
    const seg = parts.slice(0, i + 1).join('/')
    if (paths.every(p => p.startsWith(seg + '/') || p === seg)) {
      prefix = seg
    } else {
      break
    }
  }
  return prefix
}
