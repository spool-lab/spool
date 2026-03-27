import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FragmentResult } from '@spool/core'

export interface AgentInfo {
  id: string
  name: string
  path: string
}

export interface ToolCallEvent {
  toolCallId: string
  title: string
  status: string
  kind?: string
}

interface AcpSession {
  proc: ChildProcess
  conn: unknown
  sessionId: string | null
  initialized: boolean
}

interface TerminalParams { command?: string; args?: string[]; cwd?: string; sessionId?: string }
interface TerminalIdParams { terminalId: string; sessionId?: string }
interface ReadFileParams { path: string; sessionId?: string }
interface SessionNotification { update?: { sessionUpdate?: string; content?: { type: string; text?: string }; toolCallId?: string; title?: string; status?: string; kind?: string } }

/**
 * ACP Manager — connects to local agents via the Agent Client Protocol.
 *
 * For Claude Code, spawns `acp-extension-claude` as subprocess and communicates
 * via JSON-RPC over stdio using the @agentclientprotocol/sdk.
 */
/**
 * Resolve a binary path that works in both dev (terminal-launched) and
 * production (GUI-launched, minimal PATH) contexts on macOS.
 *
 * Strategy: try `which` first (works in dev), then check common locations
 * including nvm/fnm/Homebrew paths. Results are cached for the process lifetime.
 */
function resolveSystemBinary(name: string, extraSearchPaths: string[] = []): string | null {
  // Try shell lookup first — works when launched from terminal
  try {
    const p = execSync(`which ${name}`, { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    if (p) return p
  } catch {}

  // Try login shell — picks up nvm/fnm/etc even in GUI context
  try {
    const p = execSync(`bash -lc "which ${name}"`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    if (p) return p
  } catch {}

  const home = homedir()
  const searchPaths = [
    ...extraSearchPaths,
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `${home}/.local/bin/${name}`,
    `${home}/.nvm/current/bin/${name}`,
  ]
  for (const p of searchPaths) {
    if (existsSync(p)) return p
  }
  return null
}

const resolvedPaths: Record<string, string | null> = {}
function cachedResolve(name: string, extras: string[] = []): string | null {
  if (!(name in resolvedPaths)) {
    resolvedPaths[name] = resolveSystemBinary(name, extras)
  }
  return resolvedPaths[name]
}

interface AgentConfig {
  name: string
  bin: string
  envSetup?: () => Record<string, string>
}

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  claude: {
    name: 'Claude Code',
    bin: 'claude',
    envSetup: () => {
      const claudePath = cachedResolve('claude')
      return claudePath ? { CLAUDE_CODE_EXECUTABLE: claudePath } : {}
    },
  },
  codex: {
    name: 'Codex CLI',
    bin: 'codex',
  },
}

export class AcpManager {
  private detectedAgents: AgentInfo[] | null = null
  private activeSession: AcpSession | null = null

  /** Detect which agent CLIs are installed on the machine */
  async detectAgents(): Promise<AgentInfo[]> {
    if (this.detectedAgents) return this.detectedAgents

    const agents: AgentInfo[] = []
    for (const [id, config] of Object.entries(AGENT_CONFIGS)) {
      const p = cachedResolve(config.bin)
      if (p) agents.push({ id, name: config.name, path: p })
    }

    this.detectedAgents = agents
    return agents
  }

  async query(
    agentId: string,
    userQuery: string,
    _context: FragmentResult[],
    onChunk: (text: string) => void,
    onToolCall?: (event: ToolCallEvent) => void,
  ): Promise<string> {
    const agents = await this.detectAgents()
    const agent = agents.find(a => a.id === agentId)
    if (!agent) throw new Error(`Agent "${agentId}" not found. Install ${agentId} CLI first.`)

    // Cancel any running query
    this.cancel()

    const prompt = this.buildPrompt(userQuery)

    return this.queryViaAcp(agentId, prompt, onChunk, onToolCall)
  }

  /**
   * Query via ACP protocol.
   * Spawns acp-extension-claude, establishes ClientSideConnection,
   * then does initialize → newSession → prompt with streaming sessionUpdate chunks.
   */
  private async queryViaAcp(
    agentId: string,
    prompt: string,
    onChunk: (text: string) => void,
    onToolCall?: (event: ToolCallEvent) => void,
  ): Promise<string> {
    // Dynamically import the ESM-only ACP SDK
    const acp = await import('@agentclientprotocol/sdk')

    // Resolve the acp-extension binary for this agent
    const agentBin = this.resolveAcpExtension(agentId)

    // Spawn the ACP agent subprocess.
    // Must use system Node.js — not Electron's binary — because the extension
    // passes process.execPath to claude-agent-sdk as the Node executable.
    // Also set CLAUDE_CODE_EXECUTABLE so the SDK finds the real CLI.
    const nodePath = cachedResolve('node')
    if (!nodePath) throw new Error('Could not find Node.js. Ensure node is installed and in PATH.')
    const config = AGENT_CONFIGS[agentId]
    const agentEnv = {
      ...process.env as Record<string, string>,
      ...config?.envSetup?.() ?? {},
    }
    const proc = spawn(nodePath, [agentBin], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: agentEnv,
    })

    proc.stderr?.on('data', (d: Buffer) => {
      console.error(`[acp-${agentId}] ${d.toString().trim()}`)
    })

    // Convert Node streams to Web streams for the ACP SDK
    const outputWritable = new WritableStream<Uint8Array>({
      write(chunk) {
        return new Promise((resolve, reject) => {
          proc.stdin!.write(Buffer.from(chunk), (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      },
    })

    const inputReadable = new ReadableStream<Uint8Array>({
      start(controller) {
        proc.stdout!.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk))
        })
        proc.stdout!.on('end', () => controller.close())
        proc.stdout!.on('error', (err) => controller.error(err))
      },
    })

    // Create the ACP stream and client connection
    const stream = acp.ndJsonStream(outputWritable, inputReadable)

    let fullText = ''

    const MAX_TERMINAL_OUTPUT = 1024 * 1024 // 1 MB cap
    const terminals = new Map<string, { proc: ChildProcess; output: string; exitCode: number | null }>()
    let terminalCounter = 0

    function killTerminalProc(t: { proc: ChildProcess }) {
      if (t.proc.exitCode === null) try { t.proc.kill() } catch {}
    }

    function cleanupAllTerminals() {
      for (const t of terminals.values()) killTerminalProc(t)
      terminals.clear()
    }

    const conn = new acp.ClientSideConnection(() => ({
      requestPermission: async () => ({
        outcome: { outcome: 'selected' as const, optionId: 'allow' },
      }),
      extMethod: async () => ({}),
      createTerminal: async (params: TerminalParams) => {
        const id = `term-${++terminalCounter}`
        const termProc = spawn(params.command ?? 'bash', params.args ?? [], {
          cwd: params.cwd || process.cwd(),
          env: process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        })
        const state = { proc: termProc, output: '', exitCode: null as number | null }
        const append = (d: Buffer) => {
          if (state.output.length < MAX_TERMINAL_OUTPUT) state.output += d.toString()
        }
        termProc.stdout?.on('data', append)
        termProc.stderr?.on('data', append)
        termProc.on('close', (code) => { state.exitCode = code })
        terminals.set(id, state)
        return { terminalId: id }
      },
      terminalOutput: async (params: TerminalIdParams) => {
        const t = terminals.get(params.terminalId)
        return { output: t?.output ?? '', exitCode: t?.exitCode ?? null }
      },
      waitForTerminalExit: async (params: TerminalIdParams) => {
        const t = terminals.get(params.terminalId)
        if (!t) return { exitCode: -1 }
        if (t.exitCode !== null) return { exitCode: t.exitCode }
        return new Promise((resolve) => {
          t.proc.on('close', (code) => resolve({ exitCode: code ?? -1 }))
        })
      },
      killTerminal: async (params: TerminalIdParams) => {
        const t = terminals.get(params.terminalId)
        if (t) killTerminalProc(t)
        return {}
      },
      releaseTerminal: async (params: TerminalIdParams) => {
        const t = terminals.get(params.terminalId)
        if (t) killTerminalProc(t)
        terminals.delete(params.terminalId)
        return {}
      },
      readTextFile: async (params: ReadFileParams) => {
        try {
          return { content: await readFile(params.path, 'utf8') }
        } catch {
          return { content: '' }
        }
      },
      sessionUpdate: async (notification: SessionNotification) => {
        const update = notification.update
        if (!update || !('sessionUpdate' in update)) return

        switch (update.sessionUpdate) {
          case 'agent_message_chunk': {
            const content = update.content
            if (content?.type === 'text' && content.text) {
              const text = typeof content.text === 'string' ? content.text : JSON.stringify(content.text)
              fullText += text
              onChunk(text)
            }
            break
          }
          case 'tool_call': {
            onToolCall?.({
              toolCallId: update.toolCallId,
              title: update.title ?? 'Tool call',
              status: update.status ?? 'in_progress',
              kind: update.kind,
            })
            break
          }
          case 'tool_call_update': {
            onToolCall?.({
              toolCallId: update.toolCallId,
              title: update.title ?? '',
              status: update.status ?? 'in_progress',
              kind: update.kind,
            })
            break
          }
        }
      },
    }), stream)

    this.activeSession = { proc, conn, sessionId: null, initialized: false }

    try {
      // Step 1: Initialize
      await conn.initialize({
        clientCapabilities: {},
        protocolVersion: 1,
      })

      // Step 2: New session
      const sessionResp = await conn.newSession({
        cwd: process.cwd(),
        mcpServers: [],
      })
      const sessionId = sessionResp.sessionId
      this.activeSession.sessionId = sessionId

      // Step 3: Prompt (this blocks until the agent finishes)
      // ACP PromptRequest takes `prompt: ContentBlock[]`, not `messages`
      await conn.prompt({
        sessionId,
        prompt: [{ type: 'text', text: prompt }],
      })

      return fullText
    } catch (err) {
      if (fullText) return fullText
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err) ? String((err as Record<string, unknown>).message) : String(err)
      throw new Error(msg)
    } finally {
      cleanupAllTerminals()
      this.killSession()
    }
  }

  /**
   * Resolve the path to the acp-extension-claude entry point.
   * The package is ESM-only so require.resolve() won't work directly.
   */
  private resolveAcpExtension(name: string): string {
    const override = process.env['SPOOL_ACP_AGENT_BIN']
    if (override) return override

    const pkg = `acp-extension-${name}`
    const entryPoints = ['dist/index.js', `bin/${pkg}.js`]
    const roots = [
      resolve(__dirname, '..', '..', 'node_modules', pkg),
      resolve(__dirname, '..', 'node_modules', pkg),
      resolve(__dirname, '..', '..', '..', 'node_modules', pkg),
    ]
    for (const root of roots) {
      for (const entry of entryPoints) {
        const candidate = join(root, entry)
        if (existsSync(candidate)) return candidate
      }
    }
    throw new Error(`Could not find ${pkg}. Run: pnpm add ${pkg}`)
  }

  cancel(): void {
    this.killSession()
  }

  dispose(): void {
    this.cancel()
  }

  private killSession(): void {
    if (this.activeSession) {
      const { proc } = this.activeSession
      if (proc && proc.exitCode === null) {
        try { proc.kill() } catch { /* */ }
      }
      this.activeSession = null
    }
  }

  /**
   * Build a prompt that gives the agent knowledge about the Spool SQLite DB
   * and lets it decide how to query the knowledge base.
   */
  private buildPrompt(userQuery: string): string {
    return [
      'You have access to a local knowledge base called Spool that indexes the user\'s AI coding sessions (Claude Code, Codex CLI).',
      'The database is at ~/.spool/spool.db (SQLite with FTS5). You can query it directly with the `sqlite3` CLI.',
      '',
      'Schema:',
      '  sources(id, name TEXT, base_path TEXT)  -- "claude" or "codex"',
      '  projects(id, source_id, slug, display_path, display_name, last_synced)',
      '  sessions(id, project_id, source_id, session_uuid TEXT, title TEXT, started_at TEXT, ended_at TEXT, message_count INT, has_tool_use INT)',
      '  messages(id, session_id, source_id, role TEXT, content_text TEXT, timestamp TEXT, tool_names TEXT)',
      '  messages_fts(content_text)  -- FTS5 virtual table, content synced from messages',
      '',
      'Example queries:',
      '  # FTS search',
      '  sqlite3 ~/.spool/spool.db "SELECT m.content_text, s.title, s.started_at, p.display_name FROM messages_fts f JOIN messages m ON m.id = f.rowid JOIN sessions s ON s.id = m.session_id JOIN projects p ON p.id = s.project_id WHERE messages_fts MATCH \'search terms\' ORDER BY rank LIMIT 10"',
      '',
      '  # Recent sessions',
      '  sqlite3 ~/.spool/spool.db "SELECT session_uuid, title, started_at, message_count FROM sessions ORDER BY started_at DESC LIMIT 20"',
      '',
      '  # Sessions from last N days',
      '  sqlite3 ~/.spool/spool.db "SELECT s.title, s.started_at, p.display_name, src.name FROM sessions s JOIN projects p ON p.id = s.project_id JOIN sources src ON src.id = s.source_id WHERE s.started_at > datetime(\'now\', \'-7 days\') ORDER BY s.started_at DESC"',
      '',
      'Important:',
      '- Interpret the user\'s intent and decide what to search. Don\'t just match their exact words.',
      '- For temporal queries ("what did I do recently"), filter by date.',
      '- You may run multiple queries to find relevant information.',
      '- Synthesize a concise answer. Reference specific sessions or projects when relevant.',
      '- If no results, say so clearly.',
      '- ALWAYS reply in the same language as the user\'s query.',
      '',
      `User query: "${userQuery}"`,
    ].join('\n')
  }
}
