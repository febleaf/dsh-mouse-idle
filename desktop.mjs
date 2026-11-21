import { setTimeout as sleep } from 'node:timers/promises'

export class Desktop {
  #worker
  #seconds
  #queue = Promise.resolve()
  #lifetime = new AbortController()

  constructor(worker, seconds) {
    this.#worker = worker
    this.#seconds = seconds
  }

  read(request, callSignal = this.#lifetime.signal) {
    const signal = AbortSignal.any([callSignal, this.#lifetime.signal])
    signal.throwIfAborted()
    return this.#worker.request(request, signal)
  }

  act(request, callSignal = this.#lifetime.signal) {
    const signal = AbortSignal.any([callSignal, this.#lifetime.signal])
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise((resolve, reject) => {
      // A queued call can be cancelled immediately. Once it starts, wait for
      // the worker to settle so another action cannot overtake it.
      const cancelQueued = () => reject(signal.reason)
      signal.addEventListener('abort', cancelQueued, { once: true })
      this.#queue = this.#queue.then(async () => {
        signal.removeEventListener('abort', cancelQueued)
        try {
          signal.throwIfAborted()
          resolve(await this.#attempt(request, signal))
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  close() {
    this.#lifetime.abort()
    return this.#worker.close()
  }

  async #attempt(request, signal) {
    for (;;) {
      signal.throwIfAborted()
      const result = await this.#worker.request({ ...request, idleMs: Math.round(this.#seconds() * 1000) }, signal)
      signal.throwIfAborted()
      if (result.ok === true) return result
      if (!Number.isSafeInteger(result.remainingMs) || result.remainingMs < 1) {
        throw new Error('Windows worker did not confirm idle or action completion')
      }
      await sleep(Math.min(result.remainingMs, 250), undefined, { signal })
    }
  }
}
