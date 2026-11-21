import { Desktop } from './desktop.mjs'
import { loadDshPackage } from './dsh-import.mjs'
import { NativeWorker } from './worker.mjs'

const [schema, toolRuntime] = await Promise.all([
  loadDshPackage('@deepseek-ai/schemastery'),
  loadDshPackage('@deepseek-ai/dsh-tools'),
])
const { default: Schema } = schema
const { defineTool, ToolArgsError } = toolRuntime
const defaultSeconds = 3
const maxSeconds = 2_147_483

export const name = 'windows-desktop-mouse-idle'
export const inject = ['tools']
export const Config = Schema.object({
  idleSeconds: Schema.number().min(0.001).max(maxSeconds).default(defaultSeconds).volatile(),
})

const windowArg = { type: 'string', description: 'Window ID returned by windows_desktop_inspect list.' }
const integer = description => ({ type: 'integer', description })
const text = value => [{ type: 'text', text: value }]
const writeResult = { schema: { type: 'string' }, render: (_args, value) => text(value) }
const inspectResult = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      text: { type: 'string', required: true },
      image: {
        type: 'object', additionalProperties: false,
        properties: {
          attachmentId: { type: 'string', required: true },
          mediaType: { type: 'string', enum: ['image/png'], required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
        },
      },
    },
  },
  render(_args, value) {
    const blocks = text(value.text)
    if (value.image) blocks.push({ type: 'image', attachment: value.image })
    return blocks
  },
}

function requireFields(args, names) {
  const missing = names.filter(name => args[name] === undefined || args[name] === '')
  if (missing.length) throw new ToolArgsError(missing.map(name => `${name} is required for ${args.action}`))
}

export function apply(ctx, config) {
  const seconds = () => config.idleSeconds.get()
  const desktop = new Desktop(new NativeWorker(), seconds)
  ctx.effect(() => () => desktop.close())
  const status = signal => desktop.read({ op: 'status', idleMs: Math.round(seconds() * 1000) }, signal)
  // Start observing before the first request. A failed startup will be surfaced
  // by the next explicit call, which can start a fresh native worker.
  void status().catch(() => undefined)

  ctx.tools.register(defineTool({
    name: 'windows_desktop_inspect',
    description: 'Inspect the Windows desktop without moving the mouse or changing the foreground. List windows, capture one selected window, or check mouse idle status.',
    parameters: {
      action: { type: 'string', enum: ['status', 'list', 'capture'], required: true },
      window: windowArg,
    },
    output: inspectResult,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.action === 'status') return { text: JSON.stringify(await status(exec.signal)) }
      if (args.action === 'list') return { text: JSON.stringify(await desktop.read({ op: 'list' }, exec.signal)) }
      requireFields(args, ['window'])
      const attachments = ctx.get('attachments')
      const llm = ctx.get('llm')
      const routed = exec.agent?.session.requestHeader()?.config
      const provider = routed?.provider ?? exec.agent?.options.provider
      const model = routed?.model ?? exec.agent?.options.model
      if (!attachments || !llm || !provider || !model) throw new Error('Window capture requires a DSH session with an image-capable model')
      const route = await llm.resolveModelInfo(provider, model, exec.signal)
      if (!route.inputModalities?.includes('image')) throw new Error('The current model route does not support image input')
      const shot = await desktop.read({ op: 'capture', window: args.window }, exec.signal)
      exec.signal.throwIfAborted()
      const ref = await attachments.saveImage({ data: Buffer.from(shot.data, 'base64'), mediaType: 'image/png', name: 'windows-desktop.png' })
      const image = { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height }
      const scale = shot.width === ref.width && shot.height === ref.height
        ? 'Use the attached image’s pixel coordinates for pointer actions.'
        : `Scale image coordinates by ${shot.width / ref.width} horizontally and ${shot.height / ref.height} vertically for pointer actions.`
      return { text: `Window ${args.window}, ${shot.width} × ${shot.height} native pixels. ${scale}`, image }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'windows_desktop_control',
    description: 'Perform a requested mouse action or activate a Windows window after the mouse has been continuously idle. Call one action at a time. Target the current foreground window for pointer actions. Inspect it again after each action; activate it first when needed.',
    parameters: {
      action: { type: 'string', enum: ['activate', 'click', 'drag', 'scroll'], required: true },
      window: { ...windowArg, required: true },
      x: integer('Horizontal coordinate in native pixels from the left of the captured window. Required for click, drag, and scroll.'),
      y: integer('Vertical coordinate in native pixels from the top of the captured window. Required for click, drag, and scroll.'),
      toX: integer('Drag endpoint x in native window pixels. Required for drag.'),
      toY: integer('Drag endpoint y in native window pixels. Required for drag.'),
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button for click. Defaults to left.' },
      notches: integer('Vertical wheel notches for scroll, −12 to −1 for down or 1 to 12 for up. Required for scroll.'),
    },
    output: writeResult,
    async execute({ action, ...fields }, exec) {
      const args = { action, ...fields }
      if (action !== 'activate') requireFields(args, ['x', 'y'])
      if (action === 'drag') requireFields(args, ['toX', 'toY'])
      if (action === 'scroll') requireFields(args, ['notches'])
      await desktop.act({ op: action, ...fields }, exec.signal)
      return `Windows ${action} completed after the mouse idle check.`
    },
  }))
}
