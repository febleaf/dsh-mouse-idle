window.__ModuleLoader__.load({
  id: '@local/dsh-mouse-idle',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const namespace = 'windows-desktop-mouse-idle'
    const field = 'idleSeconds'
    const messages = {
      zh: {
        label: '鼠标空闲时间（秒）', help: '鼠标移动、按键或滚动会重新计时。默认 3 秒。',
        save: '保存', reset: '恢复默认', saved: '已保存', resetDone: '已恢复默认',
        saving: '正在保存…', loading: '正在读取设置…', conflict: '设置已在别处修改。请根据当前值重新编辑。', current: '当前保存值（秒）',
        unavailable: '当前连接无法读取此设置。', readOnly: '当前连接只有读取权限。',
        invalid: '请输入大于或等于 0.001 的有效秒数。', failed: '保存失败。请核对当前设置后重试。',
        prepare: '准备 Windows 桌面操作', waiting: '等待鼠标空闲', done: 'Windows 桌面操作已完成',
        stopped: 'Windows 桌面操作已中止', error: 'Windows 桌面操作失败',
      },
      en: {
        label: 'Mouse idle time (seconds)', help: 'Moving, clicking, or scrolling restarts the timer. The default is 3 seconds.',
        save: 'Save', reset: 'Reset to default', saved: 'Saved', resetDone: 'Default restored',
        saving: 'Saving…', loading: 'Loading settings…', conflict: 'The setting changed elsewhere. Edit it again using the current value.', current: 'Current saved value (seconds)',
        unavailable: 'This connection cannot read the setting.', readOnly: 'This connection has read-only access.',
        invalid: 'Enter a valid duration of at least 0.001 seconds.', failed: 'Save failed. Check the current setting and try again.',
        prepare: 'Preparing Windows desktop action', waiting: 'Waiting for mouse idle', done: 'Windows desktop action completed',
        stopped: 'Windows desktop action stopped', error: 'Windows desktop action failed',
      },
    }
    const muted = { color: 'var(--dsw-alias-label-secondary)' }
    const fieldStyle = {
      inlineSize: '9em', padding: '0.4em 0.6em', color: 'inherit',
      borderRadius: 6, background: 'var(--dsw-alias-bg-module-platform)',
      border: '1px solid var(--dsw-alias-border-l2)',
    }
    const buttonStyle = { ...fieldStyle, inlineSize: 'auto' }

    function Settings({ form, t }) {
      const view = React.useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
      const [draft, setDraft] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [outcome, setOutcome] = React.useState(null)
      const id = React.useId()
      if (view.status !== 'ready') {
        return h('p', { role: 'status', style: muted }, t(view.status === 'loading' ? 'loading' : 'unavailable'))
      }
      const effective = view.value?.[field]
      const input = draft?.text ?? String(effective ?? '')
      const writable = view.writable && !saving
      const override = Object.hasOwn(view.user ?? {}, field)
      const value = Number(input)
      const valid = input.trim() !== '' && Number.isFinite(value) && value >= 0.001 && value <= 2147483
      async function save(reset) {
        if (!writable || (reset ? !override : !draft || !valid)) return
        if (!reset && draft.revision !== view.revision) {
          setOutcome('conflict')
          return
        }
        const change = reset ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value }
        setSaving(true)
        setOutcome(null)
        try {
          if (await form.mutate([change], reset ? view.revision : draft.revision)) {
            setDraft(null)
            setOutcome(reset ? 'resetDone' : 'saved')
          } else {
            setOutcome(form.getSnapshot().revision === view.revision ? 'failed' : 'conflict')
          }
        } catch {
          setOutcome('failed')
        } finally {
          setSaving(false)
        }
      }
      return h('form', {
        style: { display: 'grid', gap: 8, marginBlock: 16, justifyItems: 'start', fontSize: '0.875rem' },
        onSubmit: event => { event.preventDefault(); void save(false) },
      }, h('label', { htmlFor: id, style: { fontWeight: 500 } }, t('label')),
      h('div', { id: `${id}-help`, style: muted }, t('help')),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('input', {
          id, type: 'number', min: 0.001, max: 2147483, step: 'any', required: true, value: input,
          disabled: !writable, 'aria-describedby': `${id}-help`, 'aria-invalid': !valid, style: fieldStyle,
          onChange: event => { setDraft({ text: event.target.value, revision: view.revision }); setOutcome(null) },
        }),
        h('button', { type: 'submit', disabled: !writable || !valid || !draft, style: buttonStyle }, t('save')),
        h('button', { type: 'button', disabled: !writable || !override, style: buttonStyle, onClick: () => { void save(true) } }, t('reset')),
      ), h('div', { role: outcome === 'failed' || outcome === 'conflict' ? 'alert' : 'status', style: muted },
        saving ? t('saving') : outcome === 'conflict' ? `${t(outcome)} ${t('current')} ${effective}` : outcome ? t(outcome) : !view.writable ? t('readOnly') : !valid ? t('invalid') : null))
    }

    function ToolRow({ block, phase, t, inspect }) {
      let title = phase === 'preparing' ? 'prepare' : 'waiting'
      let detail
      if (phase === 'result') {
        const interrupted = ['ABORTED', 'ABORTED_BEFORE_DISPATCH', 'interrupted'].includes(block.error?.code)
        title = interrupted ? 'stopped' : block.isError ? 'error' : 'done'
        if (block.isError) detail = block.error?.reason ?? block.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      }
      return h('div', { style: { ...muted, fontSize: '0.875rem', display: 'grid', gap: 4, paddingBlock: 4 } },
        h('div', { role: 'status', style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
          h('span', { 'aria-hidden': true }, phase === 'result' ? '·' : '◷'),
          h('span', null, t(title)),
          inspect && detail ? h('button', { type: 'button', onClick: inspect, style: buttonStyle }, '…') : null),
        detail ? h('div', { style: { whiteSpace: 'pre-wrap' } }, detail) : null)
    }

    return {
      inject: ['slots', 'configForms', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(namespace, messages))
        const form = ctx.configForms.get(namespace)
        ctx.effect(() => ctx.configForms.whileServed([namespace], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config', key: '@local/dsh-mouse-idle', locale: namespace,
        }, props => h(Settings, { ...props, form })))))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview', key: 'windows_desktop_control', locale: namespace,
        }, ToolRow))
      },
    }
  },
})
