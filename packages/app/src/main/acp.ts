import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import WebSocketImpl from 'ws'
import { cachedResolve, type FragmentResult } from '@spool/core'

export interface AgentInfo {
  id: string
  name: string
  path: string
  status: 'ready' | 'not_found' | 'not_running'
  acpMode: AcpMode
}

export interface ToolCallEvent {
  toolCallId: string
  title: string
  status: string
  kind?: string
}

/** User-facing config stored in ~/.spool/agents.json */
export interface AgentsConfig {
  /** Which agent to use by default in AI mode */
  defaultAgent?: string
  /** Which sort order to use by default in search results */
  defaultSearchSort?: 'relevance' | 'newest' | 'oldest'
  /** Preferred terminal app for session resume (e.g. "iTerm2", "Warp"). Auto-detected if unset. */
  terminal?: string
  /** Custom agent definitions (extend beyond builtins) */
  customAgents?: Record<string, {
    name?: string
    bin: string
    acpMode: AcpMode
    acpArgs?: string[]
    wsEndpoint?: string
    healthCheck?: string
  }>
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
 * Supports three connection modes:
 *   - extension: via acp-extension-{name} npm packages (Claude Code, Codex CLI)
 *   - native:    CLI itself is ACP server, spawn `{bin} acp` (Kimi, OpenCode)
 *   - websocket: HTTP + WebSocket API, non-ACP (Alma)
 */

/**
 * Get the full environment from the user's login shell.
 * In GUI-launched Electron apps, process.env is minimal (no PATH, SHELL, etc.).
 * This ensures subprocesses get the same environment as a terminal session.
 */
let _loginShellEnv: Record<string, string> | null = null
function getLoginShellEnv(): Record<string, string> {
  if (_loginShellEnv) return _loginShellEnv
  const shells = [process.env['SHELL'] ?? 'zsh', 'bash']
  for (const sh of shells) {
    try {
      const raw = execSync(`${sh} -lic "env"`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
      const env: Record<string, string> = {}
      for (const line of raw.split('\n')) {
        const idx = line.indexOf('=')
        if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1)
      }
      if (env['PATH']) { _loginShellEnv = env; return env }
    } catch {}
  }
  return {}
}

type AcpMode = 'extension' | 'native' | 'websocket'

interface AgentConfig {
  name: string
  bin: string
  acpMode: AcpMode
  acpArgs?: string[]          // native mode: args to start ACP server (default: ['acp'])
  wsEndpoint?: string         // websocket mode: WebSocket URL
  healthCheck?: string        // websocket mode: HTTP health check URL
  envSetup?: () => Record<string, string>
}

const BUILTIN_AGENT_CONFIGS: Record<string, AgentConfig> = {
  claude: {
    name: 'Claude Code',
    bin: 'claude',
    acpMode: 'extension',
    envSetup: () => {
      const claudePath = cachedResolve('claude')
      return claudePath ? { CLAUDE_CODE_EXECUTABLE: claudePath } : {}
    },
  },
  codex: {
    name: 'Codex CLI',
    bin: 'codex',
    acpMode: 'extension',
  },
  kimi: {
    name: 'Kimi Code',
    bin: 'kimi',
    acpMode: 'native',
    acpArgs: ['acp'],
  },
  opencode: {
    name: 'OpenCode',
    bin: 'opencode',
    acpMode: 'native',
    acpArgs: ['acp'],
  },
  alma: {
    name: 'Alma',
    bin: 'alma',
    acpMode: 'websocket',
    wsEndpoint: 'ws://localhost:23001/ws/threads',
    healthCheck: 'http://localhost:23001/api/health',
  },
}

const AGENTS_CONFIG_PATH = join(homedir(), '.spool', 'agents.json')

function loadAgentsConfig(): AgentsConfig | null {
  try {
    return JSON.parse(readFileSync(AGENTS_CONFIG_PATH, 'utf8'))
  } catch {
    return null
  }
}

function saveAgentsConfig(config: AgentsConfig): void {
  const dir = join(homedir(), '.spool')
  mkdirSync(dir, { recursive: true })
  writeFileSync(AGENTS_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
}

/** Merge builtin + custom agent configs */
function getEffectiveConfigs(): Record<string, AgentConfig> {
  const userConfig = loadAgentsConfig()
  const result: Record<string, AgentConfig> = {}

  // Start with builtins
  for (const [id, config] of Object.entries(BUILTIN_AGENT_CONFIGS)) {
    result[id] = { ...config }
  }

  // Add custom agents from user config
  if (userConfig?.customAgents) {
    for (const [id, def] of Object.entries(userConfig.customAgents)) {
      if (!result[id] && def.bin && def.acpMode) {
        const custom: AgentConfig = {
          name: def.name ?? id,
          bin: def.bin,
          acpMode: def.acpMode,
        }
        if (def.acpArgs) custom.acpArgs = def.acpArgs
        if (def.wsEndpoint) custom.wsEndpoint = def.wsEndpoint
        if (def.healthCheck) custom.healthCheck = def.healthCheck
        result[id] = custom
      }
    }
  }

  return result
}

export class AcpManager {
  private detectedAgents: AgentInfo[] | null = null
  private activeSession: AcpSession | null = null
  private activeWs: { close: () => void } | null = null

  /** Detect all agent CLIs installed on the machine */
  async detectAgents(): Promise<AgentInfo[]> {
    const configs = getEffectiveConfigs()
    const agents: AgentInfo[] = []

    for (const [id, config] of Object.entries(configs)) {
      const p = cachedResolve(config.bin)
      agents.push({
        id,
        name: config.name,
        path: p ?? '',
        status: p ? 'ready' : 'not_found',
        acpMode: config.acpMode,
      })
    }

    this.detectedAgents = agents
    return agents
  }

  /** Get/save user config */
  getAgentsConfig(): AgentsConfig {
    return loadAgentsConfig() ?? {}
  }

  saveAgentsConfig(config: AgentsConfig): void {
    saveAgentsConfig(config)
    this.detectedAgents = null // invalidate cache
  }

  /** Get builtin agent definitions (for UI display) */
  getBuiltinAgents(): Record<string, { name: string; bin: string; acpMode: AcpMode }> {
    const result: Record<string, { name: string; bin: string; acpMode: AcpMode }> = {}
    for (const [id, config] of Object.entries(BUILTIN_AGENT_CONFIGS)) {
      result[id] = { name: config.name, bin: config.bin, acpMode: config.acpMode }
    }
    return result
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

    const configs = getEffectiveConfigs()
    const config = configs[agentId]
    if (!config) throw new Error(`No config for agent "${agentId}"`)

    const prompt = this.buildPrompt(userQuery)

    if (config.acpMode === 'websocket') {
      return this.queryViaWebSocket(config, prompt, onChunk, onToolCall)
    }
    return this.queryViaAcp(agentId, config, prompt, onChunk, onToolCall)
  }

  /**
   * Query via ACP protocol.
   * For 'extension' mode: spawns acp-extension-{name} package.
   * For 'native' mode: spawns `{bin} acp` directly (kimi, opencode).
   * Establishes ClientSideConnection, then does initialize → newSession → prompt
   * with streaming sessionUpdate chunks.
   */
  private async queryViaAcp(
    agentId: string,
    config: AgentConfig,
    prompt: string,
    onChunk: (text: string) => void,
    onToolCall?: (event: ToolCallEvent) => void,
  ): Promise<string> {
    // Dynamically import the ESM-only ACP SDK
    const acp = await import('@agentclientprotocol/sdk')

    const shellEnv = getLoginShellEnv()
    const agentEnv = {
      ...process.env as Record<string, string>,
      ...shellEnv,
      ...config.envSetup?.() ?? {},
    }

    let proc: ChildProcess

    if (config.acpMode === 'native') {
      // Native ACP: the CLI itself is the ACP server
      const binPath = cachedResolve(config.bin)
      if (!binPath) throw new Error(`Could not find ${config.bin}. Ensure it is installed and in PATH.`)
      const acpArgs = config.acpArgs ?? ['acp']
      proc = spawn(binPath, acpArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: agentEnv,
      })
    } else {
      // Extension mode: resolve acp-extension-{name} npm package
      const { path: agentBin, native } = this.resolveAcpExtension(agentId)

      if (native) {
        proc = spawn(agentBin, [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: agentEnv,
        })
      } else {
        const nodePath = cachedResolve('node')
        if (!nodePath) throw new Error('Could not find Node.js. Ensure node is installed and in PATH.')
        proc = spawn(nodePath, [agentBin], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: agentEnv,
        })
      }
    }

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
      requestPermission: async (params: { options?: Array<{ optionId: string; kind?: string }> }) => {
        try {
          // Auto-approve: pick the first allow/approve option from the agent's list
          const options = params.options ?? []
          const allowOption = options.find(o => o.kind?.startsWith('allow')) ?? options[0]
          console.log(`[ACP] requestPermission: picking optionId=${allowOption?.optionId}`)
          return { outcome: { outcome: 'selected' as const, optionId: allowOption?.optionId ?? 'allow' } }
        } catch (e) {
          console.error('[ACP] requestPermission error:', e)
          return { outcome: { outcome: 'selected' as const, optionId: 'allow' } }
        }
      },
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
        try {
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
                toolCallId: update.toolCallId ?? `tool-${Date.now()}`,
                title: update.title ?? 'Tool call',
                status: update.status ?? 'in_progress',
                kind: update.kind,
              })
              break
            }
            case 'tool_call_update': {
              onToolCall?.({
                toolCallId: update.toolCallId ?? `tool-${Date.now()}`,
                title: update.title ?? '',
                status: update.status ?? 'in_progress',
                kind: update.kind,
              })
              break
            }
          }
        } catch (e) {
          console.error('[ACP sessionUpdate] handler error:', e)
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
   * Resolve the ACP extension entry point for a given agent.
   *
   * acp-extension-claude is a pure JS package (dist/index.js) → run with Node.
   * acp-extension-codex is a native binary wrapper → resolve the platform-specific
   * binary directly (acp-extension-codex-darwin-arm64/bin/acp-extension-codex).
   */
  private resolveAcpExtension(name: string): { path: string; native: boolean } {
    const override = process.env['SPOOL_ACP_AGENT_BIN']
    if (override) return { path: override, native: false }

    const pkg = `acp-extension-${name}`
    const roots = [
      resolve(__dirname, '..', '..', 'node_modules'),
      resolve(__dirname, '..', 'node_modules'),
      resolve(__dirname, '..', '..', '..', 'node_modules'),
    ]

    // For codex, resolve the platform-specific native binary directly
    if (name === 'codex') {
      const platformPkg = `acp-extension-codex-${process.platform}-${process.arch}`
      const binaryName = process.platform === 'win32' ? 'acp-extension-codex.exe' : 'acp-extension-codex'
      for (const root of roots) {
        const candidate = join(root, platformPkg, 'bin', binaryName)
        if (existsSync(candidate)) {
          return { path: candidate.replace('app.asar', 'app.asar.unpacked'), native: true }
        }
      }
    }

    // JS entry points (claude and fallback)
    const entryPoints = ['dist/index.js', `bin/${pkg}.js`]
    for (const root of roots) {
      for (const entry of entryPoints) {
        const candidate = join(root, pkg, entry)
        if (existsSync(candidate)) {
          return { path: candidate.replace('app.asar', 'app.asar.unpacked'), native: false }
        }
      }
    }
    throw new Error(`Could not find ${pkg}. Run: pnpm add ${pkg}`)
  }

  /**
   * Query via Alma's WebSocket API (non-ACP).
   * Creates a temporary thread, connects to WS, sends generate_response,
   * streams message_delta events back as chunks/tool calls.
   */
  private async queryViaWebSocket(
    config: AgentConfig,
    prompt: string,
    onChunk: (text: string) => void,
    onToolCall?: (event: ToolCallEvent) => void,
  ): Promise<string> {
    const baseUrl = config.wsEndpoint?.replace(/^ws/, 'http').replace(/\/ws\/.*$/, '') ?? 'http://localhost:23001'
    const wsUrl = config.wsEndpoint ?? 'ws://localhost:23001/ws/threads'

    // Health check
    try {
      const resp = await fetch(config.healthCheck ?? `${baseUrl}/api/health`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    } catch {
      throw new Error(`${config.name} is not running. Please start the ${config.name} app first.`)
    }

    // Don't pass model — let Alma use its own default.
    // If Alma's defaultModel points to a disabled provider, Alma will error
    // and we surface that to the user so they can fix it with: alma model set <provider:model>

    // Create temporary thread
    const title = prompt.slice(0, 50).replace(/\n/g, ' ') || 'spool query'
    const threadResp = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `[spool] ${title}` }),
    })
    if (!threadResp.ok) throw new Error(`Failed to create thread: HTTP ${threadResp.status}`)
    const thread = await threadResp.json() as { id: string }
    const threadId = thread.id

    return new Promise<string>((resolvePromise, rejectPromise) => {
      let fullText = ''
      let settled = false

      const cleanup = () => {
        // Delete temporary thread (fire-and-forget)
        fetch(`${baseUrl}/api/threads/${threadId}`, { method: 'DELETE' }).catch(() => {})
      }

      const ws = new WebSocketImpl(wsUrl)
      this.activeWs = { close: () => { try { ws.close() } catch {} } }

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          ws.close()
          cleanup()
          if (fullText) resolvePromise(fullText)
          else rejectPromise(new Error(`${config.name} query timed out (5 min)`))
        }
      }, 5 * 60 * 1000)

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'generate_response',
          data: {
            threadId,
            userMessage: {
              role: 'user',
              parts: [{ type: 'text', text: prompt }],
            },
          },
        }))
      })

      ws.on('error', (err) => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          cleanup()
          rejectPromise(new Error(`${config.name} WebSocket error: ${err.message ?? 'connection failed'}`))
        }
      })

      ws.on('close', () => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          cleanup()
          resolvePromise(fullText)
        }
      })

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          const { type, data: payload } = msg

          if (type === 'message_delta' && payload?.threadId === threadId) {
            if (Array.isArray(payload.deltas)) {
              for (const delta of payload.deltas) {
                if (delta.type === 'text_append' && (!delta.partType || delta.partType === 'text')) {
                  // Filter out <think>...</think> blocks
                  const text = delta.text?.replace(/<think>[\s\S]*?<\/think>/g, '') ?? ''
                  if (text) {
                    fullText += text
                    onChunk(text)
                  }
                } else if (delta.type === 'tool_call_start' || (delta.type === 'part_add' && delta.part?.type?.startsWith('tool-'))) {
                  // Alma uses part_add with type "tool-Task" etc., others use tool_call_start
                  const toolType = delta.part?.type ?? delta.name ?? 'Tool call'
                  const toolId = delta.part?.toolCallId ?? delta.partIndex?.toString() ?? `tool-${Date.now()}`
                  onToolCall?.({
                    toolCallId: toolId,
                    title: toolType.replace(/^tool-/, ''),
                    status: 'in_progress',
                    kind: toolType,
                  })
                } else if (delta.type === 'tool_call_done' || delta.type === 'tool_output_set') {
                  const toolId = delta.partIndex?.toString() ?? `tool-${Date.now()}`
                  const failed = delta.state === 'output-error'
                  onToolCall?.({
                    toolCallId: toolId,
                    title: delta.name ?? 'Tool call',
                    status: failed ? 'failed' : 'completed',
                    kind: delta.name,
                  })
                }
              }
            }
          } else if ((type === 'generation_done' || type === 'generation_completed') && payload?.threadId === threadId) {
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              ws.close()
              cleanup()
              resolvePromise(fullText)
            }
          } else if (type === 'generation_error' && payload?.threadId === threadId) {
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              ws.close()
              cleanup()
              if (fullText) resolvePromise(fullText)
              else rejectPromise(new Error(payload.error ?? `${config.name} generation error`))
            }
          }
        } catch { /* ignore parse errors */ }
      })
    })
  }

  cancel(): void {
    this.killSession()
    if (this.activeWs) {
      this.activeWs.close()
      this.activeWs = null
    }
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
      'You have access to a local knowledge base called Spool that indexes:',
      '  1. The user\'s AI coding sessions (Claude Code, Codex CLI)',
      '  2. Web content captured via OpenCLI (X/Twitter bookmarks, Hacker News, etc.)',
      '',
      'The database is at ~/.spool/spool.db (SQLite with FTS5). You can query it directly with the `sqlite3` CLI.',
      '',
      '── Agent session schema ──',
      '  sources(id, name TEXT, base_path TEXT)  -- "claude" or "codex"',
      '  projects(id, source_id, slug, display_path, display_name, last_synced)',
      '  sessions(id, project_id, source_id, session_uuid TEXT, title TEXT, started_at TEXT, ended_at TEXT, message_count INT, has_tool_use INT)',
      '  messages(id, session_id, source_id, role TEXT, content_text TEXT, timestamp TEXT, tool_names TEXT)',
      '  messages_fts(content_text)  -- FTS5 virtual table, content synced from messages',
      '',
      '── OpenCLI captures schema ──',
      '  opencli_sources(id, source_id, platform TEXT, command TEXT, enabled INT, last_synced TEXT, sync_count INT)',
      '  captures(id, source_id, opencli_src_id, capture_uuid TEXT, url TEXT, title TEXT, content_text TEXT, author TEXT, platform TEXT, platform_id TEXT, content_type TEXT, captured_at TEXT, raw_json TEXT)',
      '  captures_fts(title, content_text)  -- FTS5 virtual table, content synced from captures',
      '',
      'Example queries:',
      '  # FTS search on agent sessions',
      '  sqlite3 ~/.spool/spool.db "SELECT m.content_text, s.title, s.started_at, p.display_name FROM messages_fts f JOIN messages m ON m.id = f.rowid JOIN sessions s ON s.id = m.session_id JOIN projects p ON p.id = s.project_id WHERE messages_fts MATCH \'search terms\' ORDER BY rank LIMIT 10"',
      '',
      '  # Recent sessions',
      '  sqlite3 ~/.spool/spool.db "SELECT session_uuid, title, started_at, message_count FROM sessions ORDER BY started_at DESC LIMIT 20"',
      '',
      '  # FTS search on captures (bookmarks, saved web content)',
      '  sqlite3 ~/.spool/spool.db "SELECT c.title, c.author, c.url, c.content_text, c.platform, c.captured_at FROM captures_fts f JOIN captures c ON c.id = f.rowid WHERE captures_fts MATCH \'search terms\' ORDER BY rank LIMIT 10"',
      '',
      '  # List all captures from a platform',
      '  sqlite3 ~/.spool/spool.db "SELECT title, author, url, content_text, captured_at FROM captures WHERE platform = \'twitter\' ORDER BY captured_at DESC LIMIT 20"',
      '',
      '  # What platforms are connected',
      '  sqlite3 ~/.spool/spool.db "SELECT platform, command, sync_count, last_synced FROM opencli_sources WHERE enabled = 1"',
      '',
      'Important:',
      '- Interpret the user\'s intent and decide what to search. Don\'t just match their exact words.',
      '- For questions about bookmarks, saved content, or web platforms → query captures/captures_fts.',
      '- For questions about coding sessions, projects, or what the user built → query messages/sessions.',
      '- For temporal queries ("what did I do recently"), filter by date.',
      '- You may run multiple queries to find relevant information.',
      '- Synthesize a concise answer. Reference specific items, URLs, or sessions when relevant.',
      '- If no results, say so clearly.',
      '- ALWAYS reply in the same language as the user\'s query.',
      '',
      `User query: "${userQuery}"`,
    ].join('\n')
  }
}
