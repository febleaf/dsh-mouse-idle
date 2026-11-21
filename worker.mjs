import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const compile = promisify(execFile)
const nativeSource = fileURLToPath(new URL('./native/', import.meta.url))
const references = ['System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll']
const sourceFiles = ['IdleGate.cs', 'Win32.cs', 'Worker.cs']
const applicationTimeoutMs = 15_000

export async function compileWindows(output, sources, options = {}) {
  const framework = process.arch === 'ia32' ? 'Framework' : 'Framework64'
  const compiler = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe')
  await compile(compiler, [
    '/nologo', '/utf8output', `/out:${output}`,
    ...references.map(reference => `/reference:${reference}`), ...sources,
  ], { windowsHide: true, timeout: applicationTimeoutMs, ...options })
}

export class NativeWorker {
  #lifetime = new AbortController()
  #queue = Promise.resolve()
  #runtime
  #folder
  #starting
  #closing
  #pending
  #nextId = 0

  request(request, callSignal = this.#lifetime.signal) {
    const signal = AbortSignal.any([callSignal, this.#lifetime.signal])
    if (signal.aborted) return Promise.reject(signal.reason)
    const operation = this.#queue.then(async () => {
      signal.throwIfAborted()
      await this.#ensureWorker()
      signal.throwIfAborted()
      return this.#exchange(request)
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  async #ensureWorker() {
    if (this.#runtime) return
    this.#starting ??= this.#start()
    try {
      await this.#starting
    } finally {
      this.#starting = undefined
    }
  }

  async #start() {
    if (process.platform !== 'win32') throw new Error('The Windows desktop is available only on a Windows host')
    const signal = this.#lifetime.signal
    if (!this.#folder) {
      const path = await mkdtemp(join(tmpdir(), 'dsh-mouse-idle-'))
      this.#folder = path
    }
    const executable = join(this.#folder, 'mouse-idle-worker.exe')
    try {
      await compileWindows(executable, sourceFiles.map(source => join(nativeSource, source)), { signal })
    } catch (error) {
      signal.throwIfAborted()
      throw new Error(`Windows mouse worker compilation failed: ${error.stdout?.trim() || error.message}`, { cause: error })
    }
    signal.throwIfAborted()
    const child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const output = createInterface({ input: child.stdout })
    const stopped = new Promise(resolve => child.once('close', resolve))
    const runtime = { child, stopped, diagnostics: '' }
    this.#runtime = runtime
    output.on('line', line => this.#answer(runtime, line))
    child.stderr.setEncoding('utf8').on('data', text => { runtime.diagnostics = (runtime.diagnostics + text).slice(-1500) })
    child.on('error', error => this.#fail(runtime, error))
    child.stdin.on('error', error => this.#fail(runtime, error))
    stopped.then(code => this.#fail(runtime, new Error(runtime.diagnostics.trim() || `Windows mouse worker closed (${code})`)))
  }

  #exchange(request) {
    const runtime = this.#runtime
    if (!runtime) throw new Error('Windows mouse worker is unavailable')
    return new Promise((resolve, reject) => {
      const id = ++this.#nextId
      const timer = setTimeout(() => {
        this.#fail(runtime, new Error('The Windows mouse worker did not respond. The action will not be retried.'))
      }, applicationTimeoutMs)
      this.#pending = { id, resolve, reject, timer }
      runtime.child.stdin.write(`${JSON.stringify({ ...request, id })}\n`)
    })
  }

  #answer(runtime, line) {
    if (this.#runtime !== runtime) return
    try {
      const response = JSON.parse(line)
      const pending = this.#pending
      if (pending?.id !== response.id) throw new Error('Unexpected Windows mouse worker response')
      if (typeof response.error !== 'string' && (!response.result || typeof response.result !== 'object')) {
        throw new Error('Invalid Windows mouse worker result')
      }
      this.#pending = undefined
      clearTimeout(pending.timer)
      if (typeof response.error === 'string') pending.reject(new Error(response.error))
      else pending.resolve(response.result)
    } catch (error) {
      this.#fail(runtime, error)
    }
  }

  #fail(runtime, error) {
    if (this.#runtime !== runtime) return
    const pending = this.#pending
    this.#pending = undefined
    if (pending) clearTimeout(pending.timer)
    runtime.child.kill()
    this.#starting = runtime.stopped.then(() => undefined)
    this.#runtime = undefined
    // Let the in-flight caller settle only after the worker can no longer act.
    if (pending) runtime.stopped.then(() => pending.reject(error))
  }

  close() {
    this.#closing ??= this.#stop()
    return this.#closing
  }

  async #stop() {
    this.#lifetime.abort()
    if (this.#runtime) this.#fail(this.#runtime, this.#lifetime.signal.reason)
    await this.#queue
    await this.#starting?.catch(() => undefined)
    if (this.#folder) await rm(this.#folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
