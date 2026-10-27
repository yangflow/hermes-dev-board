const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

function atom(value) {
  const listeners = new Set()
  return {
    get: () => value,
    set(next) { value = next; for (const fn of listeners) fn(next) },
    subscribe(fn) { listeners.add(fn); fn(value); return () => listeners.delete(fn) },
    count: () => listeners.size
  }
}

function harness() {
  const notices = [], calls = [], queries = [], registrations = []
  const state = {
    focusedStoredSessionId: atom('stored'), focusedSessionId: atom('runtime'),
    focusedSessionProfile: atom('dev'), profile: atom('default')
  }
  const session = { id: 'stored', title: 'ZT-1234 task', label: 'ZT-1234', profile: 'dev' }
  const results = {
    'dev-board': { data: { tasks: [{ id: '1234', repos: [] }, { id: '5678', repos: [] }] } },
    'dev-board-sessions': { data: { zt_sessions: { 1234: [session] } } },
    'dev-board-task-changes': { data: { files: [], repos: [] } }
  }
  const host = {
    state,
    notify(input) {
      assert.equal(typeof input.message, 'string')
      assert.ok(['error', 'warning', 'info', 'success'].includes(input.kind))
      notices.push(input)
    },
    async openSession(id, options) { calls.push(['session', id, options]) },
    navigate(route) { calls.push(['navigate', route]) },
    openWorkspace(id, options) { calls.push(['dock', id, options]) }
  }
  const slots = []
  let cursor = 0, pending = [], dirty = false
  const jsx = (type, props, key) => {
    if (type === 'EmptyState') assert.equal(props.hint, undefined, 'SDK EmptyState supports description, not hint')
    return { type, props: props || {}, key }
  }
  const context = vm.createContext({
    host, jsx, jsxs: jsx, cn: (...args) => args.filter(Boolean).join(' '),
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, (next) => {
        next = typeof next === 'function' ? next(slots[i].value) : next
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    useEffect(fn, deps) {
      const i = cursor++, previous = slots[i]
      if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n]))) {
        slots[i] = { deps, cleanup: previous?.cleanup }
        pending.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn() })
      }
    },
    useMemo: (fn) => fn(),
    useQuery(options) { queries.push(options); return results[options.queryKey[0]] || {} },
    window: { addEventListener() {}, removeEventListener() {} },
    ROUTES_AREA: 'routes', SIDEBAR_NAV_AREA: 'nav', PALETTE_AREA: 'palette',
    ...Object.fromEntries(['Badge', 'Button', 'EmptyState', 'ScrollArea', 'Select', 'SelectContent', 'SelectItem',
      'SelectTrigger', 'SelectValue', 'StatusDot'].map((name) => [name, name]))
  })
  const source = fs.readFileSync(path.join(__dirname, '../desktop/plugin.js'), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export default {', 'globalThis.plugin = {')
  vm.runInContext(source + '\nglobalThis.api = { useActiveZt, DockPanel, TaskCard, SessionChip, BoardPage };', context)
  const h = {
    api: context.api, state, session, host, notices, calls, queries, results, registrations,
    rest: async (url, options) => {
      calls.push(['rest', url, options])
      return url === '/zt_sessions' ? results['dev-board-sessions'].data : { ok: true }
    },
    render(fn, props) {
      let node, rounds = 0
      do {
        dirty = false; cursor = 0; pending = []
        node = fn(props)
        pending.forEach((effect) => effect())
        assert.ok(++rounds < 20, 'hook render must settle')
      } while (dirty)
      return node
    },
    dispose() { slots.forEach((slot) => slot?.cleanup?.()) }
  }
  context.plugin.register({ rest: (...args) => h.rest(...args), register: (entry) => registrations.push(entry) })
  return h
}

function nodes(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(nodes)
  return [node, ...nodes(node.props?.children)]
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ')
  if (node && typeof node === 'object') return text(node.props?.children)
  return node == null ? '' : String(node)
}
function button(node, label) {
  const found = nodes(node).find((n) => n.type === 'Button' && text(n) === label)
  assert.ok(found, 'button: ' + label)
  return found.props.onClick
}
const plain = (value) => JSON.parse(JSON.stringify(value))

test('stored id wins over runtime; profile subscriptions and cleanup follow focus', () => {
  const h = harness()
  h.results['dev-board-sessions'].data.zt_sessions['5678'] = [{ ...h.session, id: 'runtime', label: 'GH-5678' }]
  assert.equal(h.render(h.api.useActiveZt).active.id, '1234')
  h.state.focusedSessionProfile.set('default')
  assert.equal(h.render(h.api.useActiveZt).active, null)
  h.state.focusedSessionProfile.set('dev')
  h.state.focusedStoredSessionId.set('runtime')
  assert.equal(h.render(h.api.useActiveZt).active.id, '5678')
  h.dispose()
  for (const store of Object.values(h.state)) assert.equal(store.count(), 0)
})

test('runtime fallback only without stored id; compression ancestors match durable tip', () => {
  const h = harness()
  h.state.focusedStoredSessionId.set('unknown')
  h.state.focusedSessionId.set('stored')
  assert.equal(h.render(h.api.useActiveZt).active, null)
  h.state.focusedStoredSessionId.set(null)
  assert.equal(h.render(h.api.useActiveZt).active.id, '1234')
  h.session.session_ids = ['stored', 'middle', 'root']
  h.state.focusedStoredSessionId.set('root')
  assert.equal(h.render(h.api.useActiveZt).active.session.id, 'stored')
})

test('identical database ids in different profiles resolve to the owning task', () => {
  const h = harness()
  h.results['dev-board-sessions'].data.zt_sessions['5678'] = [{ ...h.session, profile: 'default', label: 'GH-5678' }]
  assert.equal(h.render(h.api.useActiveZt).active.id, '1234')
  h.state.focusedSessionProfile.set('default')
  assert.equal(h.render(h.api.useActiveZt).active.id, '5678')
})

test('task labels contain their own full id and never inherit another task prefix', () => {
  const h = harness()
  h.results['dev-board-sessions'].data.zt_sessions['5678'] = [{ ...h.session, id: 'other', label: 'GH-5678' }]
  const card = (id) => h.render(h.api.TaskCard, { task: { id, repos: [] } })
  assert.match(text(card('1234')), /ZT-1234/)
  assert.match(text(card('5678')), /GH-5678/)
  assert.match(text(card('9999')), /#9999/)
  assert.doesNotMatch(text(card('9999')), /ZT-|GH-/)
})

test('editor callback forwards POST options and displays successful completion', async () => {
  const h = harness()
  const card = h.render(h.api.TaskCard, { task: { id: '1234', repos: [] } })
  await button(card, '编辑器')()
  assert.deepEqual(plain(h.calls[0]), ['rest', '/open_editor?task=1234', { method: 'POST', timeoutMs: 20000 }])
  assert.equal(h.notices[0].kind, 'success')
})

test('editor callback catches request rejection and false success responses', async () => {
  const h = harness()
  const click = button(h.render(h.api.TaskCard, { task: { id: '1234', repos: [] } }), '编辑器')
  h.rest = async () => { throw new Error('HTTP 504: editor timed out') }
  await click()
  assert.equal(h.notices.at(-1).kind, 'error')
  assert.match(h.notices.at(-1).message, /HTTP 504: editor timed out/)
  h.rest = async () => ({ ok: false, detail: 'launcher refused' })
  await click()
  assert.match(h.notices.at(-1).message, /launcher refused/)
})

test('board opener awaits durable profile session open before docking beside chat', async () => {
  const h = harness()
  h.session.id = 'tip'
  h.session.session_ids = ['tip', 'stored']
  let finish
  h.host.openSession = async (id, options) => {
    h.calls.push(['session', id, options])
    await new Promise((resolve) => { finish = resolve })
  }
  const click = button(h.render(h.api.BoardPage), '在会话右侧打开')
  const opening = click()
  assert.deepEqual(plain(h.calls), [['session', 'tip', { profile: 'dev' }]])
  finish()
  await opening
  assert.equal(h.calls[1][0], 'dock')
  assert.equal(h.calls[1][2].dock.pane, 'workspace')
})

test('board with no match navigates to chat and docks manual task fallback', async () => {
  const h = harness()
  h.state.focusedStoredSessionId.set('unknown')
  await button(h.render(h.api.BoardPage), '在会话右侧打开')()
  assert.deepEqual(plain(h.calls[0]), ['navigate', '/'])
  assert.equal(h.calls[1][0], 'dock')
  assert.equal(h.calls[1][2].render().type, h.api.DockPanel)
})

test('board and session-chip open rejections surface errors; failed open does not dock', async () => {
  const h = harness()
  h.host.openSession = async () => { throw new Error('profile unavailable') }
  await button(h.render(h.api.BoardPage), '在会话右侧打开')()
  assert.equal(h.calls.length, 0)
  assert.match(h.notices.at(-1).message, /profile unavailable/)
  await h.api.SessionChip({ s: h.session }).props.onClick()
  assert.match(h.notices.at(-1).message, /打开会话失败.*profile unavailable/)
})

test('session chip uses SDK profile option; palette opening catches SDK dock errors', async () => {
  const h = harness()
  await h.api.SessionChip({ s: h.session }).props.onClick()
  assert.deepEqual(plain(h.calls[0]), ['session', 'stored', { profile: 'dev' }])
  h.host.openWorkspace = () => { throw new Error('dock unavailable') }
  await h.registrations.find((r) => r.id === 'open-dock').data.run()
  assert.match(h.notices.at(-1).message, /dock unavailable/)
})

test('panel distinguishes session loading, no match, and no active worktree', () => {
  const h = harness()
  const sessions = h.results['dev-board-sessions']
  sessions.isLoading = true
  assert.ok(nodes(h.render(h.api.DockPanel)).some((n) => n.props.title === '加载任务和会话…'))
  sessions.isLoading = false
  h.state.focusedStoredSessionId.set('unknown')
  let panel = h.render(h.api.DockPanel)
  assert.ok(nodes(panel).some((n) => n.props.title === '当前会话未匹配任务'))
  assert.match(text(panel), /跟随当前会话.*ZT-1234/)
  h.state.focusedStoredSessionId.set('stored')
  h.results['dev-board'].data.tasks = []
  panel = h.render(h.api.DockPanel)
  assert.ok(nodes(panel).some((n) => n.props.title === 'ZT-1234 无活跃 worktree'))
})

test('session error stays visible while manual selector can recover to a task', () => {
  const h = harness()
  h.results['dev-board-sessions'] = { isError: true, error: new Error('map offline') }
  let panel = h.render(h.api.DockPanel)
  assert.ok(nodes(panel).some((n) => n.props.title === '会话映射加载失败' && /map offline/.test(n.props.description)))
  nodes(panel).find((n) => n.type === 'Select').props.onValueChange('1234')
  panel = h.render(h.api.DockPanel)
  assert.match(text(panel), /#1234.*无未提交变更/)
  assert.ok(h.queries.some((q) => q.queryKey[0] === 'dev-board-task-changes' && q.queryKey[1] === '1234' && q.enabled))
})

test('board and task-change request errors render explicit errors, never clean status', async () => {
  const h = harness()
  h.results['dev-board-task-changes'] = { isError: true, error: new Error('changes offline') }
  let panel = h.render(h.api.DockPanel)
  assert.ok(nodes(panel).some((n) => n.props.title === '任务变更加载失败' && n.props.description === 'changes offline'))
  assert.doesNotMatch(text(panel), /无未提交变更/)
  const query = h.queries.findLast((q) => q.queryKey[0] === 'dev-board-task-changes')
  await query.queryFn()
  assert.equal(h.calls.at(-1)[1], '/task_changes?task=1234')
  h.results['dev-board'] = { isError: true, error: new Error('board offline') }
  panel = h.render(h.api.DockPanel)
  assert.ok(nodes(panel).some((n) => n.props.title === '任务加载失败' && n.props.description === 'board offline'))
})
