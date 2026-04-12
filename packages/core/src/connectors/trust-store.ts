import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIRST_PARTY_SCOPE = '@spool-lab/'
const CONFIG_FILE = 'config.json'

export class TrustStore {
  private trusted: Set<string>
  private readonly configPath: string
  private configData: Record<string, unknown>

  constructor(private readonly spoolDir: string) {
    this.configPath = join(spoolDir, CONFIG_FILE)
    this.configData = this.readConfig()
    const list = Array.isArray(this.configData['trustedConnectors'])
      ? (this.configData['trustedConnectors'] as string[])
      : []
    this.trusted = new Set(list)
  }

  isTrusted(packageName: string): boolean {
    if (packageName.startsWith(FIRST_PARTY_SCOPE)) return true
    return this.trusted.has(packageName)
  }

  add(packageName: string): void {
    this.trusted.add(packageName)
    this.save()
  }

  remove(packageName: string): void {
    this.trusted.delete(packageName)
    this.save()
  }

  private save(): void {
    mkdirSync(this.spoolDir, { recursive: true })
    this.configData['trustedConnectors'] = [...this.trusted]
    writeFileSync(this.configPath, JSON.stringify(this.configData, null, 2), 'utf8')
  }

  private readConfig(): Record<string, unknown> {
    if (!existsSync(this.configPath)) return {}
    try {
      return JSON.parse(readFileSync(this.configPath, 'utf8'))
    } catch {
      return {}
    }
  }
}
