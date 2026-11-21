import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

const entry = new URL('../desktop.mjs', import.meta.url)
const action = { op: 'click', window: '1', x: 4, y: 5 }

async function makeDesktop(request, seconds = () => 3) {
  const { Desktop } = await import(entry)
  return new Desktop({ request, close() {} }, seconds)
}

test('a newly active mouse extends the wait and the worker checks before each attempt', async () => {
  const states = [{ remainingMs: 12 }, { remainingMs: 18 }, { ok: true }]
  const delays = []
  let seconds = 3
  const desktop = await makeDesktop(async ({ idleMs, ...request }) => {
    assert.deepEqual(request, action)
    delays.push(idleMs)
    seconds = 1.25
    return states.shift()
  }, () => seconds)
  const started = performance.now()
  assert.deepEqual(await desktop.act(action), { ok: true })
  assert.deepEqual(delays, [3000, 1250, 1250])
  assert.ok(performance.now() - started >= 28)
})

test('concurrent sessions serialize desktop actions but window reads can proceed during idle wait', async () => {
  const order = []
  const desktop = await makeDesktop(async ({ op, x }) => {
    order.push(x ?? op)
    if (order.length === 1) return { remainingMs: 25 }
    return { ok: true }
  })
  const first = desktop.act(action)
  const second = desktop.act({ ...action, x: 8 })
  await sleep(5)
  await desktop.read({ op: 'list' })
  await Promise.all([first, second])
  assert.deepEqual(order, [4, 'list', 4, 8])
})

test('cancellation removes the waiting action without releasing a click later', async () => {
  const controller = new AbortController()
  const sent = []
  const desktop = await makeDesktop(async ({ x }) => {
    sent.push(x)
    return x === 4 ? { remainingMs: 60_000 } : { ok: true }
  })
  const pending = desktop.act(action, controller.signal)
  const denied = assert.rejects(pending, { name: 'AbortError' })
  const next = desktop.act({ ...action, x: 8 })
  await sleep(5)
  controller.abort()
  await denied
  assert.deepEqual(await next, { ok: true })
  assert.deepEqual(sent, [4, 8])
})

test('an already cancelled queued call settles while another action is still waiting', async () => {
  const first = new AbortController()
  const second = new AbortController()
  const sent = []
  const desktop = await makeDesktop(async ({ x }) => {
    sent.push(x)
    return { remainingMs: 60_000 }
  })
  const running = assert.rejects(desktop.act(action, first.signal), { name: 'AbortError' })
  const queued = assert.rejects(desktop.act({ ...action, x: 8 }, second.signal), { name: 'AbortError' })
  try {
    second.abort()
    await queued
    assert.deepEqual(sent, [4])
  } finally {
    first.abort()
    await running
  }
})

test('an unavailable Windows worker never returns success or retries the input', async () => {
  let attempts = 0
  const desktop = await makeDesktop(async () => {
    attempts++
    throw new Error('input desktop unavailable')
  })
  await assert.rejects(desktop.act(action), /input desktop unavailable/)
  assert.equal(attempts, 1)
})
