import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadDshPackage } from '../dsh-import.mjs'
import { compileWindows } from '../worker.mjs'

const pluginPath = await realpath(join(process.env.DSH_PROFILE_DIR, 'node_modules', '@local/dsh-mouse-idle', 'index.js'))
const plugin = await import(pathToFileURL(pluginPath).href)
const { Context } = await loadDshPackage('@deepseek-ai/cordis')
const systemPrompt = await loadDshPackage('@deepseek-ai/dsh-system-prompt')
const tools = await loadDshPackage('@deepseek-ai/dsh-tools')
const executor = await loadDshPackage('@deepseek-ai/dsh-tool-executor-native')
const scratch = await mkdtemp(join(tmpdir(), 'dsh-mouse-idle-smoke-'))
const contexts = []
let fixture, stopped

async function mount(config) {
  const ctx = new Context()
  const fibers = []
  contexts.push(fibers)
  for (const [entry, settings] of [[systemPrompt.default], [tools.default], [executor], [plugin, config]]) {
    const fiber = ctx.plugin(entry, settings)
    fibers.push(fiber)
    await fiber.await()
  }
  assert.ok(ctx.tools.get('windows_desktop_inspect'))
  assert.ok(ctx.tools.get('windows_desktop_control'))
  return ctx
}

let serial = 0
async function tool(ctx, name, args, signal = AbortSignal.timeout(12_000)) {
  const { results } = await ctx.tools.execute({
    signal, calls: [{ type: 'tool-call', id: `smoke-${++serial}`, name, arguments: JSON.stringify(args) }],
  })
  return results[0].result
}

async function inspect(ctx, action) {
  const result = await tool(ctx, 'windows_desktop_inspect', { action })
  assert.equal(result.isError, false, JSON.stringify(result.content))
  return JSON.parse(result.content[0].text)
}

try {
  const title = `DSH Mouse Idle Verification ${process.pid}`
  const executable = join(scratch, 'test-window.exe')
  await compileWindows(executable, [fileURLToPath(new URL('./WindowsFixture.cs', import.meta.url))])
  fixture = spawn(executable, [title], { stdio: ['ignore', 'pipe', 'pipe'] })
  stopped = once(fixture, 'close')
  const lines = []
  const messages = createInterface({ input: fixture.stdout })
  messages.on('line', line => lines.push(line))
  assert.equal((await once(messages, 'line', { signal: AbortSignal.timeout(5000) }))[0], 'READY')
  const ctx = await mount({})
  const initial = await inspect(ctx, 'status')
  assert.equal(initial.monitoring, true)
  assert.equal(initial.desktopAvailable, true)
  assert.equal(initial.idleMs, 3000)
  let list, win
  for (let attempt = 0; attempt < 10 && !win; attempt++) {
    list = await inspect(ctx, 'list')
    win = list.windows.find(window => window.title === title)
    if (!win) await sleep(50)
  }
  assert.ok(win, `enumeration did not find the dedicated test window (${list.windows.length} windows, fixture exit ${fixture.exitCode}, fixture PID ${fixture.pid}, matching windows ${JSON.stringify(list.windows.filter(window => window.title.startsWith('DSH Mouse Idle Verification') || window.window.endsWith(`:${fixture.pid}`)))})`)
  const start = performance.now()
  const activate = () => tool(ctx, 'windows_desktop_control', { action: 'activate', window: win.window })
  const focus = await activate()
  const elapsed = Math.round(performance.now() - start)
  assert.ok(elapsed >= initial.remainingMs - 300, `foreground check finished too early (${elapsed} ms; initial remaining ${initial.remainingMs} ms)`)
  const foreground = (await inspect(ctx, 'list')).windows.some(window => window.window === win.window && window.foreground)
  assert.equal(foreground, !focus.isError)
  assert.equal(lines.filter(line => line.startsWith('CLICK')).length, 0)

  const clickArgs = { action: 'click', window: win.window, x: 150, y: 110 }
  const click = await tool(ctx, 'windows_desktop_control', clickArgs)
  if (foreground) {
    assert.equal(click.isError, false, JSON.stringify(click.content))
    for (let attempt = 0; attempt < 20 && lines.length < 2; attempt++) await sleep(25)
    assert.equal(lines[1], 'CLICK Left')
  } else {
    assert.match(focus.content[0].text, /Windows refused to focus/)
    assert.equal(click.isError, true)
    assert.match(click.content[0].text, /foreground window/)
  }

  const configured = await mount({ idleSeconds: 6.5 })
  const next = await inspect(configured, 'status')
  assert.equal(next.idleMs, 6500)
  assert.ok(next.remainingMs > 6000)
  const stop = new AbortController()
  const pending = tool(configured, 'windows_desktop_control', clickArgs, stop.signal)
  await sleep(150)
  stop.abort()
  const cancelled = await pending
  assert.equal(cancelled.isError, true)
  assert.match(cancelled.errorInfo?.code ?? cancelled.content[0]?.text ?? '', /abort/i)
  await sleep(next.remainingMs)
  const nativeClicks = lines.filter(line => line.startsWith('CLICK')).length
  assert.equal(nativeClicks, foreground ? 1 : 0, 'cancelled request emitted a delayed click')
  console.log(JSON.stringify({ defaultMs: initial.idleMs, measuredWaitMs: elapsed, configuredMs: next.idleMs, foreground, nativeClicks, cancelledClickSuppressed: true }))
} finally {
  if (fixture) fixture.kill()
  await stopped?.catch(() => undefined)
  for (const fibers of contexts.reverse()) {
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
  await rm(scratch, { recursive: true, force: true })
}
