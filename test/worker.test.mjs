import assert from 'node:assert/strict'
import test from 'node:test'
import { NativeWorker } from '../worker.mjs'

const windows = { skip: process.platform !== 'win32', timeout: 30_000 }

test('the native Windows worker registers a mouse monitor and lists windows', windows, async () => {
  const worker = new NativeWorker()
  try {
    const result = await worker.request({ op: 'status', idleMs: 3000 })
    assert.equal(result.monitoring, true)
    assert.equal(result.idleMs, 3000)
    assert.ok(result.remainingMs >= 0 && result.remainingMs <= 3000)
    assert.ok(Array.isArray((await worker.request({ op: 'list' })).windows))
  } finally {
    await worker.close()
  }
})

test('a stale native window handle is rejected instead of targeting another window', windows, async () => {
  const worker = new NativeWorker()
  try {
    await assert.rejects(worker.request({ op: 'click', window: '0', x: 0, y: 0, idleMs: 3000 }), /window.*(valid|available)/i)
  } finally {
    await worker.close()
  }
})
