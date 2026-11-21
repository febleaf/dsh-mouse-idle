import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { compileWindows } from '../worker.mjs'

const run = promisify(execFile)

test('the native idle gate requires a full new interval after activity and button release', { skip: process.platform !== 'win32' }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dsh-mouse-idle-test-'))
  try {
    const executable = join(folder, 'idle-test.exe')
    await compileWindows(executable, ['./IdleGateTests.cs', '../native/IdleGate.cs'].map(source => fileURLToPath(new URL(source, import.meta.url))))
    const { stdout } = await run(executable, { windowsHide: true, timeout: 5000 })
    assert.match(stdout, /passed 10 assertions/)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
