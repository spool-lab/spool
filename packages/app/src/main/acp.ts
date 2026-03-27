import { spawn, execSync, type ChildProcess } from 'node:child_process'
import type { FragmentResult } from '@spool/core'

export interface AgentInfo {
  id: string
  name: string
  path: string
}

interface AcpSession {
  proc: ChildProcess
  conn: any // ClientSideConnection
  sessionId: string | null
  initialized: boolean
}

/**
 * ACP Manager — connects to local agents via the Agent Client Protocol.
 *
 * For Claude Code, spawns `acp-extension-claude` as subprocess and communicates
 * via JSON-RPC over stdio using the @agentclientprotocol/sdk.
 */
export class AcpManager {
  private detectedAgents: AgentInfo[] | null = null
  private activeSession: AcpSession | null = null

  /** Detect which agent CLIs are installed on the machine */
  async detectAgents(): Promise<AgentInfo[]> {
    if (this.detectedAgents) return this.detectedAgents

    const agents: AgentInfo[] = []
    const candidates = [
      { id: 'claude', name: 'Claude Code', bin: 'claude' },
      { id: 'codex', name: 'Codex CLI', bin: 'codex' },
    ]

    for (const c of candidates) {
      try {
        const p = execSync(`which ${c.bin}`, { encoding: 'utf8', timeout: 5000 }).trim()
        if (p) agents.push({ id: c.id, name: c.name, path: p })
      } catch {
        // not found
      }
    }

    this.detectedAgents = agents
    return agents
  }

  async query(
    agentId: string,
    userQuery: string,
    context: FragmentResult[],
    onChunk: (text: string) => void,
  ): Promise<string> {
    const agents = await this.detectAgents()
    const agent = agents.find(a => a.id === agentId)
    if (!agent) throw new Error(`Agent "${agentId}" not found. Install ${agentId} CLI first.`)

    // Cancel any running query
    this.cancel()

    const prompt = this.buildPrompt(userQuery, context)

    if (agentId === 'claude') {
      return this.queryViaAcp(prompt, onChunk)
    } else {
      return this.queryCodex(agent.path, prompt, onChunk)
    }
  }

  /**
   * Query via ACP protocol.
   * Spawns acp-extension-claude, establishes ClientSideConnection,
   * then does initialize → newSession → prompt with streaming sessionUpdate chunks.
   */
  private async queryViaAcp(
    prompt: string,
    onChunk: (text: string) => void,
  ): Promise<string> {
    // Dynamically import the ESM-only ACP SDK
    const acp = await import('@agentclientprotocol/sdk')

    // Resolve the acp-extension-claude binary
    const agentBin = this.resolveAcpExtensionClaude()

    // Spawn the ACP agent subprocess
    const proc = spawn(process.execPath, [agentBin], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    proc.stderr?.on('data', (d: Buffer) => {
      console.error(`[acp-claude] ${d.toString().trim()}`)
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

    const conn = new acp.ClientSideConnection(() => ({
      requestPermission: async () => ({
        outcome: { outcome: 'selected' as const, optionId: 'allow' },
      }),
      sessionUpdate: async (notification: any) => {
        const update = notification.update
        if (update &&
            'sessionUpdate' in update &&
            update.sessionUpdate === 'agent_message_chunk') {
          const content = update.content
          if (content?.type === 'text' && content.text) {
            fullText += content.text
            onChunk(content.text)
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
      throw err
    } finally {
      // Clean up the subprocess
      this.killSession()
    }
  }

  /**
   * Resolve the path to the acp-extension-claude entry point.
   * The package is ESM-only so require.resolve() won't work directly.
   */
  private resolveAcpExtensionClaude(): string {
    const path = require('node:path')
    const fs = require('node:fs')
    // __dirname in dev = packages/app/out/main
    // node_modules is at packages/app/node_modules (../../node_modules from __dirname)
    const candidates = [
      path.resolve(__dirname, '..', '..', 'node_modules', 'acp-extension-claude', 'dist', 'index.js'),
      path.resolve(__dirname, '..', 'node_modules', 'acp-extension-claude', 'dist', 'index.js'),
      path.resolve(__dirname, '..', '..', '..', 'node_modules', 'acp-extension-claude', 'dist', 'index.js'),
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }
    throw new Error('Could not find acp-extension-claude. Run: pnpm add acp-extension-claude')
  }

  /**
   * Codex CLI: use `codex exec --json <prompt>`
   */
  private queryCodex(
    binPath: string,
    prompt: string,
    onChunk: (text: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(binPath, ['exec', '--json', prompt], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      const session: AcpSession = { proc, conn: null, sessionId: null, initialized: false }
      this.activeSession = session

      let fullText = ''
      const readline = require('node:readline')
      const rl = readline.createInterface({ input: proc.stdout! })
      rl.on('line', (line: string) => {
        try {
          const event = JSON.parse(line)
          if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
            fullText += event.item.text
            onChunk(event.item.text)
          }
        } catch {
          // skip non-JSON lines
        }
      })

      proc.stderr?.on('data', (d: Buffer) => {
        console.error(`[codex] ${d.toString().trim()}`)
      })

      proc.stdin!.end()

      proc.on('close', (code) => {
        this.activeSession = null
        if (code === 0 || fullText) {
          resolve(fullText)
        } else {
          reject(new Error(`Codex exited with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        this.activeSession = null
        reject(err)
      })
    })
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

  private buildPrompt(userQuery: string, context: FragmentResult[]): string {
    const fragments = context.slice(0, 8).map((f, i) => {
      const snippet = f.snippet.replace(/<\/?mark>/g, '')
      const date = f.startedAt.slice(0, 10)
      return `[${i + 1}] ${f.source} · ${date} · ${f.project.split('/').pop()}\n${snippet}`
    }).join('\n\n')

    return [
      `I'm searching my personal knowledge base for: "${userQuery}"`,
      '',
      'Here are the most relevant fragments from my indexed sessions:',
      '',
      fragments,
      '',
      'Based on these fragments from my own notes and conversations, synthesize a concise answer to my query. Reference which sources (by number) support your answer.',
    ].join('\n')
  }
}
