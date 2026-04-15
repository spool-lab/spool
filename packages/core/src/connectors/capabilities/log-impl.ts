import { Effect } from 'effect'
import type { LogCapability, LogFields } from '@spool-lab/connector-sdk'

export function makeLogCapabilityFor(connectorId: string): LogCapability {
  const baseAttrs: LogFields = { 'connector.id': connectorId }

  const emit = (
    level: 'Debug' | 'Info' | 'Warning' | 'Error',
    msg: string,
    fields?: LogFields,
  ) => {
    const attrs = { ...baseAttrs, ...fields }
    const effect =
      level === 'Debug' ? Effect.logDebug(msg) :
      level === 'Info' ? Effect.logInfo(msg) :
      level === 'Warning' ? Effect.logWarning(msg) :
      Effect.logError(msg)
    Effect.runFork(effect.pipe(Effect.annotateLogs(attrs)))
  }

  return {
    debug(msg, fields) { emit('Debug', msg, fields) },
    info(msg, fields) { emit('Info', msg, fields) },
    warn(msg, fields) { emit('Warning', msg, fields) },
    error(msg, fields) { emit('Error', msg, fields) },

    async span<T>(
      name: string,
      fn: () => Promise<T>,
      opts?: { attributes?: LogFields },
    ): Promise<T> {
      const attrs = { ...baseAttrs, ...opts?.attributes }
      return Effect.runPromise(
        Effect.tryPromise({
          try: fn,
          catch: e => e,
        }).pipe(
          Effect.withSpan(`connector.${name}`, { attributes: attrs }),
        ),
      )
    },
  }
}
