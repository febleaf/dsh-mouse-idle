import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function loadDshPackage(name) {
  const installedCli = join('app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const anchors = [
    import.meta.url,
    ...(process.env.DSH_INSTALL_DIR ? [join(process.env.DSH_INSTALL_DIR, 'package.json')] : []),
    join(process.resourcesPath ?? join(dirname(process.execPath), 'resources'), installedCli),
  ]
  for (const anchor of anchors) {
    let manifestPath
    try {
      manifestPath = createRequire(anchor).resolve(`${name}/package.json`)
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
      continue
    }
    const { exports } = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const root = exports['.']
    const entry = typeof root === 'string' ? root : root.import ?? root.default
    return import(pathToFileURL(join(dirname(manifestPath), entry)).href)
  }
  throw new Error(`Cannot resolve ${name} from the DeepSeek Harness installation`)
}
