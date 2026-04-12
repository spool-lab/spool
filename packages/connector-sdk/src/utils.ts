export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason)
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => {
      if (timeout) clearTimeout(timeout)
      reject(signal!.reason)
    }
    timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
