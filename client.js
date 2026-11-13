/**
 * Client half of the session-delete bundle.
 *
 * Adds one hover button to the end of a Session row and one confirmation
 * dialog in `shell.overlay`. Clicking the button asks the Host for a preview
 * (log size, subagent count, running work), the dialog shows it, and only an
 * explicit confirm calls the destructive endpoint.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-delete-row',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'session-delete'
    const PREVIEW_PATH = '/session-delete/preview'
    const DELETE_PATH = '/session-delete/delete'

    const DICTS = {
      en: {
        'actions.delete': 'Delete session',
        'confirm.title': 'Delete this session?',
        'confirm.desc':
          '“{title}” and its local transcript will be deleted permanently. This cannot be undone.',
        'confirm.untitled': 'Untitled session',
        'confirm.subagents': '{n} subagent session(s) will be deleted too',
        'confirm.logs': 'Local logs: {size}',
        'confirm.noLogs': 'No local log yet',
        'confirm.open': 'This session is still open in the app; it will be closed before deletion.',
        'confirm.running': 'This session is running; its work will be stopped first.',
        'confirm.activity': 'Work that will be stopped',
        'confirm.loading': 'Reading session details…',
        'confirm.loadFailed': 'Session details are unavailable; deletion can still be attempted.',
        'confirm.action': 'Delete',
        'confirm.pending': 'Deleting…',
        cancel: 'Cancel',
        close: 'Close',
        'activity.turn': 'The current turn',
        'activity.subagent': '{n} subagent(s)',
        'activity.job': '{n} background job(s)',
        'activity.schedule': '{n} schedule(s)',
        'activity.other': '{n} other task(s)',
        'result.done': 'Session deleted.',
        'result.warnings': 'Deleted, but {n} item(s) could not be cleaned up.',
        'error.invalid-id': 'This session id is not valid.',
        'error.running': 'This session could not be stopped. Stop it, then delete again.',
        'error.open': 'This session is still initializing. Try again in a moment.',
        'error.busy': 'The transcript file is still in use. Refresh the page and try deleting again.',
        'error.not-found': 'This session no longer exists.',
        'error.failed': 'The session could not be deleted.',
      },
      zh: {
        'actions.delete': '删除会话',
        'confirm.title': '删除这个会话？',
        'confirm.desc': '“{title}”及其本地会话记录将被永久删除，无法恢复。',
        'confirm.untitled': '未命名会话',
        'confirm.subagents': '将同时删除 {n} 个子智能体会话',
        'confirm.logs': '本地日志约 {size}',
        'confirm.noLogs': '暂无本地日志',
        'confirm.open': '该会话仍在应用中打开，删除前会先关闭它。',
        'confirm.running': '该会话正在运行，删除前会先停止它的工作。',
        'confirm.activity': '将被停止的工作',
        'confirm.loading': '正在读取会话信息…',
        'confirm.loadFailed': '无法读取会话信息，仍可尝试删除。',
        'confirm.action': '删除',
        'confirm.pending': '正在删除…',
        cancel: '取消',
        close: '关闭',
        'activity.turn': '当前这一轮对话',
        'activity.subagent': '{n} 个子代理',
        'activity.job': '{n} 个后台任务',
        'activity.schedule': '{n} 个定时任务',
        'activity.other': '{n} 个其他任务',
        'result.done': '会话已删除。',
        'result.warnings': '已删除，但有 {n} 项未能清理。',
        'error.invalid-id': '会话 ID 无效。',
        'error.running': '无法停止该会话，请先手动停止后再删除。',
        'error.open': '该会话仍在初始化，请稍后再试。',
        'error.busy': '会话日志文件仍被占用，请刷新页面后重新删除。',
        'error.not-found': '该会话已不存在。',
        'error.failed': '删除会话失败。',
      },
    }

    const STYLES = `
.sd-icon-button{border-radius:4px;cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;flex:none;justify-content:center;align-items:center;margin:-4px;padding:0;display:inline-flex}
.sd-icon-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
@media (hover:hover){.sd-icon-button:hover{color:var(--dsw-alias-state-error-primary)}}
.sd-overlay{position:fixed;inset:0;z-index:1200;background:#00000052;display:flex;align-items:center;justify-content:center;padding:24px}
.sd-dialog{box-sizing:border-box;width:min(440px,100%);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 12px 32px #00000029;padding:20px;color:var(--dsw-alias-label-primary)}
.sd-title{margin:0 0 8px;font-size:16px;font-weight:600;line-height:24px}
.sd-desc{margin:0 0 12px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.sd-meta{margin:0 0 12px;display:flex;gap:4px 14px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.sd-note{margin:0 0 12px;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.sd-activity{margin:0 0 12px;padding-left:18px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.sd-activity li{overflow-wrap:anywhere}
.sd-status{margin:0 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.sd-error{margin:0 0 12px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.sd-warning{margin:0 0 12px;padding-left:18px;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.sd-warning li{overflow-wrap:anywhere}
.sd-footer{display:flex;justify-content:flex-end;gap:8px}
.sd-button{font:inherit;font-size:13px;line-height:18px;padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer}
.sd-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.sd-button:disabled{opacity:.5;cursor:default}
@media (hover:hover){.sd-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}
.sd-button-danger:not(:disabled){color:var(--dsw-alias-state-error-primary)}
`

    // The row button and the overlay dialog live in different slot entries, so
    // the pending confirmation is shared through this small store.
    const listeners = new Set()
    let pending = null

    function publish(next) {
      pending = next
      for (const listener of [...listeners]) listener()
    }

    function usePending() {
      const [value, setValue] = React.useState(pending)
      React.useEffect(() => {
        const sync = () => setValue(pending)
        listeners.add(sync)
        sync()
        return () => {
          listeners.delete(sync)
        }
      }, [])
      return value
    }

    /** Map a Host refusal code to localized copy; anything else is the generic failure. */
    function messageFor(t, error) {
      const code = error !== null && typeof error === 'object' ? error.code : undefined
      switch (code) {
        case 'session-delete/invalid-id':
          return t('error.invalid-id')
        case 'session-delete/running':
          return t('error.running')
        case 'session-delete/open':
          return t('error.open')
        case 'session-delete/busy':
          return t('error.busy')
        case 'session-delete/not-found':
          return t('error.not-found')
        default:
          return t('error.failed')
      }
    }

    /** Human-readable byte size; units stay untranslated. */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
      return `${String(rounded)} ${units[unit]}`
    }

    /** One activity family line: localized label and, when present, the names. */
    function activityLine(t, entry) {
      const count = typeof entry?.count === 'number' ? entry.count : 1
      const names = Array.isArray(entry?.names) ? entry.names.filter(Boolean) : []
      let label
      switch (entry?.kind) {
        case 'turn':
          label = t('activity.turn')
          break
        case 'subagent':
          label = t('activity.subagent', { n: count })
          break
        case 'job':
          label = t('activity.job', { n: count })
          break
        case 'schedule':
          label = t('activity.schedule', { n: count })
          break
        default:
          label = t('activity.other', { n: count })
      }
      return names.length > 0 ? `${label} — ${names.join(', ')}` : label
    }

    /** POST one JSON body to a plugin route and decode the envelope. */
    async function postJson(path, payload) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      })
      if (!response.ok) {
        const error = new Error(`request failed with HTTP ${String(response.status)}`)
        error.code = `http-${String(response.status)}`
        throw error
      }
      return await response.json()
    }

    function TrashIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M2.75 4h10.5M6.5 4V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4 4l.6 8.1a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4L12 4M6.5 6.5v4M9.5 6.5v4',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** Hover button at the end of one Session row. */
    function DeleteRowAction({ sessionId, displayTitle, t }) {
      const label = t('actions.delete')
      return h(
        'button',
        {
          type: 'button',
          className: 'sd-icon-button',
          'aria-label': label,
          title: label,
          onClick: () => {
            const request = { sessionId, displayTitle: displayTitle ?? '', preview: null }
            publish(request)
            postJson(PREVIEW_PATH, { sessionId })
              .then((payload) => {
                // The dialog may have been closed or moved to another row while
                // the preview was in flight; only update the matching request.
                if (pending === null || pending.sessionId !== sessionId) return
                if (payload !== null && payload.ok === true) {
                  publish({ ...pending, preview: payload.value })
                }
              })
              .catch(() => {
                // The delete call re-validates; a failed preview keeps the dialog usable.
                if (pending === null || pending.sessionId !== sessionId) return
                publish({ ...pending, previewError: true })
              })
          },
        },
        h(TrashIcon),
      )
    }

    function DeleteDialogForm({ t, request }) {
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [outcome, setOutcome] = React.useState(null)
      const cancelRef = React.useRef(null)

      React.useEffect(() => {
        cancelRef.current?.focus()
      }, [])

      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && !busy) publish(null)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [busy])

      const close = () => {
        if (!busy) publish(null)
      }

      const confirm = () => {
        setBusy(true)
        setError(null)
        postJson(DELETE_PATH, { sessionId: request.sessionId })
          .then((payload) => {
            setBusy(false)
            if (payload !== null && payload.ok === true) {
              if (Array.isArray(payload.value?.warnings) && payload.value.warnings.length > 0) {
                setOutcome(payload.value)
              } else {
                publish(null)
              }
              return
            }
            setError(messageFor(t, payload?.error))
          })
          .catch((reason) => {
            setBusy(false)
            setError(messageFor(t, reason))
          })
      }

      const title = String(request.displayTitle ?? '').trim() || t('confirm.untitled')
      const preview = request.preview

      if (outcome !== null) {
        return h(
          'div',
          {
            className: 'sd-overlay',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) publish(null)
            },
          },
          h(
            'div',
            { className: 'sd-dialog', role: 'dialog', 'aria-modal': 'true' },
            h('h2', { className: 'sd-title' }, t('result.done')),
            h('p', { className: 'sd-desc' }, t('result.warnings', { n: outcome.warnings.length })),
            h(
              'ul',
              { className: 'sd-warning' },
              outcome.warnings.slice(0, 4).map((warning, index) =>
                h('li', { key: String(index) }, `${warning.target}: ${warning.reason}`),
              ),
            ),
            h(
              'div',
              { className: 'sd-footer' },
              h('button', { type: 'button', className: 'sd-button', onClick: () => publish(null) }, t('close')),
            ),
          ),
        )
      }

      return h(
        'div',
        {
          className: 'sd-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) close()
          },
        },
        h(
          'div',
          {
            className: 'sd-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'sd-delete-title',
            'aria-describedby': 'sd-delete-desc',
          },
          h('h2', { id: 'sd-delete-title', className: 'sd-title' }, t('confirm.title')),
          h('p', { id: 'sd-delete-desc', className: 'sd-desc' }, t('confirm.desc', { title })),
          preview == null
            ? h('p', { className: 'sd-status' }, request.previewError === true ? t('confirm.loadFailed') : t('confirm.loading'))
            : h(
                React.Fragment,
                null,
                h(
                  'p',
                  { className: 'sd-meta' },
                  preview.subagents > 0
                    ? h('span', { key: 'subagents' }, t('confirm.subagents', { n: preview.subagents }))
                    : null,
                  h('span', { key: 'logs' }, preview.logs === 0 ? t('confirm.noLogs') : t('confirm.logs', { size: formatBytes(preview.bytes) })),
                ),
                preview.open ? h('p', { className: 'sd-note' }, t('confirm.open')) : null,
                preview.running ? h('p', { className: 'sd-note' }, t('confirm.running')) : null,
                Array.isArray(preview.activity) && preview.activity.length > 0
                  ? h(
                      'ul',
                      { className: 'sd-activity', 'aria-label': t('confirm.activity') },
                      preview.activity.map((entry, index) =>
                        h('li', { key: String(index) }, activityLine(t, entry)),
                      ),
                    )
                  : null,
              ),
          busy ? h('p', { className: 'sd-status', role: 'status' }, t('confirm.pending')) : null,
          error !== null ? h('p', { className: 'sd-error', role: 'alert' }, error) : null,
          h(
            'div',
            { className: 'sd-footer' },
            h(
              'button',
              {
                type: 'button',
                className: 'sd-button',
                ref: cancelRef,
                disabled: busy,
                onClick: close,
              },
              t('cancel'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'sd-button sd-button-danger',
                disabled: busy,
                onClick: confirm,
              },
              t('confirm.action'),
            ),
          ),
        ),
      )
    }

    /** `shell.overlay` entry: the shared notice, plus the styles both entries use. */
    function DeleteDialog({ t }) {
      const request = usePending()
      return h(
        React.Fragment,
        null,
        h('style', { key: 'session-delete-styles' }, STYLES),
        request === null
          ? null
          : h(DeleteDialogForm, {
              key: request.sessionId,
              t,
              request,
            }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const offLocale = ctx.locale.register(NS, DICTS)
        ctx.effect(() => () => {
          offLocale()
        })

        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
          ctx.slots.register(
            { name: 'sidebar.workspaces.session.row.action', id: 'delete-session', order: 300 },
            (props) => h(DeleteRowAction, { ...props, t }),
          ),
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'delete-session-dialog', order: 900 },
            () => h(DeleteDialog, { t }),
          ),
        )
      },
    }
  },
})
