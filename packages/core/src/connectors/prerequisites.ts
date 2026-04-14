import type { Prerequisite, SetupStep, SetupStatus, ExecCapability } from '@spool/connector-sdk'
import type { ConnectorPackage } from './types.js'
import { valid, gte } from 'semver'

function baseStep(p: Prerequisite, status: SetupStatus, extras: Partial<SetupStep> = {}): SetupStep {
  const step: SetupStep = {
    id: p.id,
    label: p.name,
    kind: p.kind,
    status,
    install: p.install,
    ...extras,
  }
  if (p.docsUrl !== undefined) step.docsUrl = p.docsUrl
  if (p.minVersion !== undefined && step.minVersion === undefined) step.minVersion = p.minVersion
  return step
}

export class PrerequisiteChecker {
  private cache = new Map<string, SetupStep[]>()
  private inFlight = new Map<string, Promise<SetupStep[]>>()

  constructor(private exec: ExecCapability) {}

  getCached(packageId: string): SetupStep[] | undefined {
    return this.cache.get(packageId)
  }

  invalidate(packageId: string): void {
    this.cache.delete(packageId)
  }

  async check(pkg: ConnectorPackage): Promise<SetupStep[]> {
    const existing = this.inFlight.get(pkg.id)
    if (existing) return existing
    const promise = this.runCheck(pkg).finally(() => this.inFlight.delete(pkg.id))
    this.inFlight.set(pkg.id, promise)
    return promise
  }

  private async runCheck(pkg: ConnectorPackage): Promise<SetupStep[]> {
    const prereqs = pkg.prerequisites ?? []
    const steps: SetupStep[] = []
    const okIds = new Set<string>()

    for (const p of prereqs) {
      const unmet = (p.requires ?? []).filter(id => !okIds.has(id))
      if (unmet.length > 0) {
        steps.push(baseStep(p, 'pending'))
        continue
      }
      const step = await this.detectOne(p)
      steps.push(step)
      if (step.status === 'ok') okIds.add(p.id)
    }

    this.cache.set(pkg.id, steps)
    return steps
  }

  private async detectOne(p: Prerequisite): Promise<SetupStep> {
    if (p.detect.type !== 'exec') {
      return baseStep(p, 'error', { hint: `Unknown detect type: ${(p.detect as any).type}` })
    }
    const timeout = p.detect.timeoutMs ?? 5000
    let result: { exitCode: number; stdout: string; stderr: string }
    try {
      result = await this.exec.run(p.detect.command, p.detect.args, { timeout })
    } catch (e) {
      const msg = (e as Error).message ?? ''
      // TODO: fragile substring sniff — the ExecCapability contract does not
      // define a recognizable timeout signal (no err.code, err.name, or
      // { timedOut } flag). See packages/connector-sdk/src/capabilities.ts
      // near ExecCapability for a proposed fix.
      if (/timeout/i.test(msg)) return baseStep(p, 'error', { hint: 'Detection timed out' })
      return baseStep(p, 'missing')
    }

    if (p.detect.matchStdout) {
      const re = new RegExp(p.detect.matchStdout)
      return re.test(result.stdout + result.stderr)
        ? baseStep(p, 'ok')
        : baseStep(p, 'missing')
    }

    if (p.detect.versionRegex && p.minVersion) {
      const vm = new RegExp(p.detect.versionRegex).exec(result.stdout)
      if (!vm || !vm[1]) {
        return baseStep(p, 'error', { hint: 'Could not parse version' })
      }
      const detectedVersion = vm[1]
      if (!valid(detectedVersion)) {
        return baseStep(p, 'error', { hint: 'Could not parse detected version' })
      }
      if (gte(detectedVersion, p.minVersion)) {
        return baseStep(p, 'ok', { detectedVersion })
      }
      return baseStep(p, 'outdated', {
        detectedVersion,
        hint: `Detected ${detectedVersion}, requires ≥ ${p.minVersion}`,
      })
    }

    return result.exitCode === 0 ? baseStep(p, 'ok') : baseStep(p, 'missing')
  }
}
