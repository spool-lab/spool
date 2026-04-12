import type { FetchCapability } from '@spool/connector-sdk'

export function makeFetchCapability(
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): FetchCapability {
  return fetchFn
}
