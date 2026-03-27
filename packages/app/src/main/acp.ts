import { spawn, execSync, type ChildProcess } from 'node:child_process'
import * as readline from 'node:readline'
import type { FragmentResult } from '@spool/core'

export interface AgentInfo {
  id: string
  name: string
  path: string
}

export class AcpManager {
  private detectedAgents: AgentInfo[] | null = null
  private activeProcess: ChildProcess | null = null

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
      return this.queryClaude(agent.path, prompt, onChunk)
    } else {
      return this.queryCodex(agent.path, prompt, onChunk)
    }
  }

  /**
   * Claude Code: use `claude -p --output-format stream-json --verbose --bare`
   * Streams JSONL, each line is a JSON event. Text chunks come as assistant messages.
   */
  private queryClaude(
    binPath: string,
    prompt: string,
    onChunk: (text: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(binPath, [
        '-p', '--output-format', 'stream-json', '--verbose',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      this.activeProcess = proc

      let fullText = ''
      let lastSeenText = '' // Track cumulative text to extract deltas

      const rl = readline.createInterface({ input: proc.stdout! })
      rl.on('line', (line) => {
        try {
          const event = JSON.parse(line)
          if (event.type === 'assistant' && event.message?.content) {
            // Each assistant event contains the full content so far
            // Extract the text delta by comparing to what we've seen
            for (const block of event.message.content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                if (block.text.length > lastSeenText.length) {
                  const delta = block.text.slice(lastSeenText.length)
                  lastSeenText = block.text
                  fullText = block.text
                  onChunk(delta)
                }
              }
            }
          } else if (event.type === 'result' && typeof event.result === 'string') {
            if (event.is_error) {
              // Auth errors, etc. — reject
              reject(new Error(event.result))
              return
            }
            // Final result — use if we haven't streamed anything
            if (!fullText) {
              fullText = event.result
              onChunk(event.result)
            }
          }
        } catch {
          // skip non-JSON lines
        }
      })

      proc.stderr?.on('data', (d: Buffer) => {
        console.error(`[claude] ${d.toString().trim()}`)
      })

      proc.stdin!.write(prompt)
      proc.stdin!.end()

      proc.on('close', (code) => {
        this.activeProcess = null
        if (code === 0 || fullText) {
          resolve(fullText)
        } else {
          reject(new Error(`Claude exited with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        this.activeProcess = null
        reject(err)
      })
    })
  }

  /**
   * Codex CLI: use `codex exec --json <prompt>`
   * Streams JSONL with item.completed events containing agent messages.
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

      this.activeProcess = proc

      let fullText = ''

      const rl = readline.createInterface({ input: proc.stdout! })
      rl.on('line', (line) => {
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
        this.activeProcess = null
        if (code === 0 || fullText) {
          resolve(fullText)
        } else {
          reject(new Error(`Codex exited with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        this.activeProcess = null
        reject(err)
      })
    })
  }

  cancel(): void {
    if (this.activeProcess && this.activeProcess.exitCode === null) {
      try { this.activeProcess.kill() } catch { /* */ }
      this.activeProcess = null
    }
  }

  dispose(): void {
    this.cancel()
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
