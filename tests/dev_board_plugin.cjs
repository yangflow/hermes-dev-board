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
  const notices = [], calls = [], queries = [], registrations = [], cleanups = []
  const workspaces = new Map()
  const state = {
    focusedStoredSessionId: atom('stored'), focusedSessionId: atom('runtime'),
    focusedSessionProfile: atom('dev'), profile: atom('default')
  }
  const session = { id: 'stored', title: 'ZT-1234 task', label: 'ZT-1234', profile: 'dev' }
  const results = {
    'dev-board': { data: { api_version: 2, tasks: [{ id: '1234', repos: [] }, { id: '5678', repos: [] }] } },
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
    getGateway: () => ({ request: async (method, params) => { calls.push(['rpc', method, params]); return method === 'session.create' ? { session_id: 'runtime-task', stored_session_id: 'stored-task' } : {} } }),
    newChat() { throw new Error('newChat only creates a draft') },
    async openSession(id, options) { calls.push(['session', id, options]) },
    navigate(route) { calls.push(['navigate', route]) },
    openWorkspace(id, options) { calls.push(['dock', id, options]); workspaces.set(id, options); return () => workspaces.delete(id) }
  }
  const slots = []
  let cursor = 0, pending = [], dirty = false
  const jsx = (type, props, key) => {
    if (type === 'EmptyState') assert.equal(props.hint, undefined, 'SDK EmptyState supports description, not hint')
    return { type, props: props || {}, key }
  }
  const context = vm.createContext({
    URL, host, jsx, jsxs: jsx, cn: (...args) => args.filter(Boolean).join(' '),
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, (next) => {
        next = typeof next === 'function' ? next(slots[i].value) : next
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    useRef(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { current: initial }
      return slots[i]
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
      'SelectTrigger', 'SelectValue', 'StatusDot', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map((name) => [name, name]))
  })
  const source = fs.readFileSync(path.join(__dirname, '../dev-board/desktop/plugin.js'), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export default {', 'globalThis.plugin = {')
  vm.runInContext(source + '\nglobalThis.api = { useActiveZt, DockPanel, TaskCard, SessionChip, BoardPage, ReviewLinks, useReviews, openReview };', context)
  const h = {
    api: context.api, state, session, host, notices, calls, queries, results, registrations, workspaces,
    unload() { cleanups.forEach((fn) => fn()) },
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
  context.plugin.register({ onDispose: (fn) => cleanups.push(fn), os: { openExternal: async (url) => { calls.push(['external', url]); return true } }, rest: (...args) => h.rest(...args), register: (entry) => registrations.push(entry) })
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
  const found = nodes(node).find((n) => n.type === 'Button' && text(n).replace(/^▷ /, '').replace(/ ↗$/, '') === label)
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
  h.results['dev-board-sessions'].data.zt_sessions['5678'] = [{ ...h.session, id: 'other', title: 'GH-5678 other task', label: 'GH-5678' }]
  const card = (id) => h.render(h.api.TaskCard, { task: { id, repos: [] } })
  assert.match(text(card('1234')), /ZT-1234/)
  assert.match(text(card('5678')), /GH-5678/)
  assert.match(text(card('9999')), /#9999/)
  assert.doesNotMatch(text(card('9999')), /ZT-|GH-/)
})

test('editor callback forwards POST options and displays successful completion', async () => {
  const h = harness()
  const card = h.render(h.api.TaskCard, { task: { id: '1234', repos: [] } })
  await button(card, '在 VS Code 打开')()
  assert.deepEqual(plain(h.calls[0]), ['rest', '/open_editor?task=1234', { method: 'POST', timeoutMs: 20000 }])
  assert.equal(h.notices[0].kind, 'success')
  assert.match(h.notices[0].message, /VS Code 打开命令已完成/)
})

test('editor callback catches request rejection and false success responses', async () => {
  const h = harness()
  const click = button(h.render(h.api.TaskCard, { task: { id: '1234', repos: [] } }), '在 VS Code 打开')
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

const reviewRepo = { repo: 'api', dir: '/worktrees/api-1234', branch: 'feat/exact' }
const reviewData = { status: 'ok', repository: 'github.com/team/repo', branch: 'feat/exact', reviews: [
  { provider: 'github', number: 7, title: 'Fix request', url: 'https://github.com/team/repo/pull/7', target_branch: 'main', state: 'merged', draft: true },
  { provider: 'gitlab', number: 8, title: 'Next request', url: 'https://git.example/team/repo/-/merge_requests/8', target_branch: 'release', state: 'closed', draft: false }
], manual: ['https://review.example/manual'] }

test('review refresh forces exactly one request and keeps the shared worktree/branch query key stable', async () => {
  const h = harness()
  h.results['dev-board-reviews'] = { refetch: () => h.queries.at(-1).queryFn() }
  const render = () => h.render(() => h.api.useReviews(reviewRepo.dir, reviewRepo.branch))
  const query = render()
  let options = h.queries.at(-1)
  const key = plain(options.queryKey)
  assert.deepEqual(key, ['dev-board-reviews', reviewRepo.dir, reviewRepo.branch])
  assert.equal(options.staleTime, 60000)
  assert.equal(options.refetchInterval, 60000)
  assert.equal(options.retry, false)
  await options.queryFn()
  assert.deepEqual(plain(h.calls.at(-1)), ['rest', '/reviews?dir=%2Fworktrees%2Fapi-1234', { timeoutMs: 20000 }])
  for (let refresh = 0; refresh < 2; refresh++) {
    const before = h.calls.length
    query.refresh()
    assert.equal(h.calls.length, before + 1, 'refresh starts its request immediately')
    assert.equal(h.calls.at(-1)[1], '/reviews?dir=%2Fworktrees%2Fapi-1234&force=true')
    render()
    options = h.queries.at(-1)
    assert.deepEqual(plain(options.queryKey), key)
    for (let interval = 0; interval < 2; interval++) {
      await options.queryFn()
      assert.equal(h.calls.at(-1)[1], '/reviews?dir=%2Fworktrees%2Fapi-1234')
    }
  }
  assert.equal(h.calls.filter((call) => call[1].includes('&force=true')).length, 2)
  const other = harness()
  other.render(() => other.api.useReviews(reviewRepo.dir, reviewRepo.branch))
  assert.deepEqual(plain(other.queries.at(-1).queryKey), key)
  h.rest = async () => { throw new Error('review offline') }
  await assert.rejects(options.queryFn(), /review offline/)
})

test('review links show count, number, title, target, state and draft; use ctx.os.openExternal', async () => {
  const h = harness()
  h.results['dev-board-reviews'] = { data: reviewData }
  const panel = h.render(h.api.ReviewLinks, { repo: reviewRepo })
  assert.match(text(panel), /api · 3 · 已加载/)
  assert.match(text(panel), /PR #7 Fix request → main 已合并 草稿/)
  assert.match(text(panel), /MR !8 Next request → release 已关闭/)
  await nodes(panel).find((n) => n.type === 'button' && text(n).startsWith('PR #7')).props.onClick()
  await nodes(panel).find((n) => n.type === 'button' && text(n).startsWith('手工')).props.onClick()
  assert.deepEqual(plain(h.calls), [['external', reviewData.reviews[0].url], ['external', reviewData.manual[0]]])
})

test('external open failures, false SDK results and credential/scheme URLs surface errors', async () => {
  const h = harness()
  for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:secret@example.com/review']) {
    await h.api.openReview(url)
    assert.match(h.notices.at(-1).message, /无效链接/)
  }
  assert.equal(h.calls.length, 0)
  // Re-register with the actual SDK boolean contract.
  const source = fs.readFileSync(path.join(__dirname, '../dev-board/desktop/plugin.js'), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export default {', 'globalThis.plugin = {')
  const notices = []
  const context = vm.createContext({ URL, host: { notify: (n) => notices.push(n) },
    ROUTES_AREA: 'routes', SIDEBAR_NAV_AREA: 'nav', PALETTE_AREA: 'palette' })
  vm.runInContext(source + '\nglobalThis.openReview = openReview', context)
  for (const openExternal of [async () => false, async () => { throw new Error('OS rejected') }]) {
    context.plugin.register({ onDispose() {}, rest() {}, os: { openExternal }, register() {} })
    await context.openReview('https://host/review')
    assert.equal(notices.at(-1).kind, 'error')
  }
  assert.match(notices.at(-1).message, /OS rejected/)
})

test('review loading, HTTP error, empty, unsupported, unavailable, timeout and partial stay distinct', () => {
  const cases = [
    [{ isLoading: true }, /加载中/],
    [{ isError: true, error: new Error('HTTP 409 detached') }, /请求失败.*HTTP 409 detached/],
    [{ data: { status: 'empty' } }, /0 · 无关联审阅/],
    [{ data: { status: 'unsupported' } }, /未配置自动查询/],
    [{ data: { status: 'unavailable' } }, /网关未安装审阅 CLI/],
    [{ data: { status: 'timeout' } }, /查询超时/],
    [{ data: { status: 'error', message: 'login failed' } }, /查询失败.*login failed/],
    [{ data: { ...reviewData, status: 'partial', message: 'incomplete' } }, /结果不完整/]
  ]
  for (const [result, expected] of cases) {
    const h = harness()
    h.results['dev-board-reviews'] = result
    assert.match(text(h.render(h.api.ReviewLinks, { repo: reviewRepo })), expected)
  }
})

test('manual add/remove POST exact options, refresh and failures handled in built-in form', async () => {
  const h = harness()
  let refreshes = 0
  h.results['dev-board-reviews'] = { data: reviewData, refetch: async () => { refreshes++; return h.queries.at(-1).queryFn() } }
  const render = () => h.render(h.api.ReviewLinks, { repo: reviewRepo })
  nodes(render()).find(n => n.props['aria-label'] === '刷新 api 审阅').props.onClick()
  assert.equal(h.calls.at(-1)[1], '/reviews?dir=%2Fworktrees%2Fapi-1234&force=true')
  refreshes = 0
  await nodes(render()).find(n => n.props['aria-label'] === '为 api 添加链接').props.onClick()
  let panel = render()
  nodes(panel).find((n) => n.type === 'input').props.onChange({ target: { value: 'https://host/review?x=1&y=2' } })
  panel = render()
  await nodes(panel).find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(plain(h.calls.at(-2)), ['rest', '/review_links?dir=%2Fworktrees%2Fapi-1234&action=add&url=https%3A%2F%2Fhost%2Freview%3Fx%3D1%26y%3D2', { method: 'POST', timeoutMs: 20000 }])
  assert.equal(h.calls.at(-1)[1], '/reviews?dir=%2Fworktrees%2Fapi-1234')
  assert.equal(refreshes, 1)
  await button(render(), '移除')()
  assert.match(h.calls.at(-2)[1], /action=remove/)
  assert.equal(h.calls.at(-1)[1], '/reviews?dir=%2Fworktrees%2Fapi-1234')
  assert.equal(refreshes, 2)
  h.rest = async () => { throw new Error('write refused') }
  await button(render(), '移除')()
  assert.match(text(render()), /write refused/)
  h.rest = async () => ({ ok: false, detail: 'disk full' })
  await button(render(), '移除')()
  assert.match(text(render()), /disk full/)
  h.rest = async () => ({ ok: true })
  h.results['dev-board-reviews'].refetch = async () => ({ isError: true, error: new Error('refresh failed') })
  await button(render(), '移除')()
  assert.match(text(render()), /refresh failed/)
})

test('board repo rows and dock all/per-repo selection include code reviews without replacing changes', () => {
  const h = harness()
  const repos = [reviewRepo, { ...reviewRepo, repo: 'web', dir: '/worktrees/web-1234' }]
  const task = { id: '1234', repos }
  let card = h.render(h.api.TaskCard, { task, onPickRepo() {} })
  assert.equal(nodes(card).filter((n) => n.type === h.api.ReviewLinks).length, 0)
  assert.equal(nodes(card).filter(n => n.props.className === 'db-row-action').length, 2)
  const dock = harness()
  dock.results['dev-board'].data.tasks[0].repos = repos
  dock.results['dev-board-task-changes'].data.repos = repos
  dock.results['dev-board-task-changes'].data.files = [{ dir: reviewRepo.dir, repo: 'api', path: 'file.py', status: 'M', added: 1, removed: 1 }]
  let panel = dock.render(dock.api.DockPanel)
  assert.equal(nodes(panel).filter((n) => n.type === dock.api.ReviewLinks).length, 2)
  assert.match(text(panel), /文件/)
  const selects = nodes(panel).filter((n) => n.type === 'Select')
  assert.equal(selects[0].props.value, 'auto')
  selects[1].props.onValueChange('api')
  panel = dock.render(dock.api.DockPanel)
  assert.deepEqual(nodes(panel).filter((n) => n.type === dock.api.ReviewLinks).map((n) => n.props.repo.repo), ['api'])
  const row = nodes(panel).find((n) => typeof n.type === 'function' && n.props.row?.type === 'file')
  row.props.onPick()
  panel = dock.render(dock.api.DockPanel)
  assert.ok(nodes(panel).some((n) => typeof n.type === 'function' && n.type.name === 'FileCompare'))
  assert.equal(nodes(panel).find((n) => n.type === 'Select').props.value, 'auto')
})

test('task title, configured launcher and compact review identity', async () => {
  const h = harness()
  const card = h.render(h.api.TaskCard, { task: { id: '1234', repos: [reviewRepo] }, editorName: 'Cursor' })
  assert.match(text(card), /ZT-1234\s+task/)
  const heading = nodes(card).find(n => n.props.className === 'db-title')
  assert.equal((text(heading).match(/ZT-1234/g) || []).length, 1)
  assert.equal(nodes(heading).find(n => n.type === 'strong').props.title, 'ZT-1234 task')
  await button(card, '在 Cursor 打开')()
  assert.match(h.notices.at(-1).message, /Cursor/)
  h.results['dev-board-reviews'] = { data: { ...reviewData, status: 'unsupported', message: 'host is not configured; manual links only' } }
  const panel = h.render(h.api.ReviewLinks, { repo: reviewRepo, showRepo: false })
  assert.doesNotMatch(text(panel), /github.com|feat\/exact|host is not configured|代码审阅 · api/)
  assert.match(text(panel), /未配置自动查询/)
})


test('unload removes retained workspace render; registration never opens and fresh plugin can reopen', async () => {
  const h = harness()
  assert.equal(h.workspaces.size, 0)
  const open = h.registrations.find((r) => r.id === 'open-dock').data.run
  await open()
  assert.equal(h.workspaces.get('worktree').render().type, h.api.DockPanel)
  h.unload()
  assert.equal(h.workspaces.size, 0)
  await open()
  assert.equal(h.workspaces.size, 0)
  const fresh = harness()
  assert.equal(fresh.workspaces.size, 0)
  await fresh.registrations.find((r) => r.id === 'open-dock').data.run()
  assert.equal(fresh.workspaces.get('worktree').render().type, fresh.api.DockPanel)
})

test('dock headings, compact identities, clean wording and editor metadata', async () => {
  const h = harness()
  h.results['dev-board'].data.editor_name = 'Cursor'
  h.results['dev-board'].data.tasks[0].repos = [reviewRepo, { ...reviewRepo, repo: 'web', dir: '/web' }]
  const panel = h.render(h.api.DockPanel)
  assert.match(text(panel), /ZT-1234 task/)
  assert.match(text(panel), /WORKTREE.*无未提交变更.*文件变更.*PR\/MR/)
  assert.deepEqual(nodes(panel).filter((n) => n.type === h.api.ReviewLinks).map((n) => [n.props.repo.repo, n.props.compact]), [['api', true], ['web', true]])
  await button(panel, '在 Cursor 打开')()
  assert.equal(h.calls.at(-1)[1], '/open_editor?task=1234')
})

test('unload during session activation cannot resurrect the pane', async () => {
  const h = harness()
  let finish
  h.host.openSession = () => new Promise((resolve) => { finish = resolve })
  const opening = button(h.render(h.api.BoardPage), '在会话右侧打开')()
  await Promise.resolve()
  h.unload()
  finish()
  await opening
  assert.equal(h.workspaces.size, 0)
})

test('all repositories retain identical file paths as distinct selectable identities', () => {
  const h = harness()
  h.results['dev-board-task-changes'].data.files = ['api', 'web'].map((repo) => ({
    repo, dir: '/worktrees/' + repo, path: 'same.py', status: 'M', added: 1, removed: 0
  }))
  const panel = h.render(h.api.DockPanel)
  const rows = nodes(panel).filter((n) => n.props.row?.type === 'file')
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0].key, rows[1].key)
  assert.deepEqual(rows.map((n) => n.props.row.path), ['same.py', 'same.py'])
  rows[1].props.onPick()
  h.render(h.api.DockPanel)
  assert.deepEqual(plain(h.queries.findLast((q) => q.queryKey[0] === 'dev-board-diff').queryKey), ['dev-board-diff', '/worktrees/web', 'same.py'])
})

test('one session opens directly and reports open failures; no sessions keep editor action', async () => {
  const h = harness()
  const render = () => h.render(h.api.TaskCard, { task: { id: '1234', repos: [] } })
  await button(render(), '打开会话')()
  assert.deepEqual(plain(h.calls.at(-1)), ['session', 'stored', { profile: 'dev' }])
  assert.equal(nodes(render()).filter(n => n.type === 'Select').length, 0)
  h.host.openSession = async () => { throw new Error('profile unavailable') }
  await button(render(), '打开会话')()
  assert.match(h.notices.at(-1).message, /打开会话失败：profile unavailable/)
  h.results['dev-board-sessions'].data.zt_sessions['1234'] = []
  const card = render()
  assert.ok(!nodes(card).some(n => n.type === 'Button' && /会话/.test(text(n))))
  assert.equal(nodes(card).filter(n => n.type === 'Select').length, 0)
  assert.ok(button(card, '在 VS Code 打开'))
})

test('single open action toggles full profile session choices without opening a preferred session', async () => {
  const h = harness()
  const title = 'A complete session title with a long distinguishing suffix'
  const other = { ...h.session, profile: undefined, title }
  h.session.title = title
  h.results['dev-board-sessions'].data.zt_sessions['1234'] = [other, h.session]
  const render = () => h.render(h.api.TaskCard, { task: { id: '1234', repos: [] } })
  let card = render()
  assert.equal(nodes(card).filter(n => n.type === h.api.SessionChip).length, 0)
  assert.equal(nodes(card).filter(n => n.type === 'Select').length, 0)
  assert.equal(nodes(card).filter(n => n.type === 'Button' && /会话/.test(text(n))).length, 1)
  button(card, '打开会话')()
  card = render()
  assert.equal(h.calls.length, 0)
  assert.equal(nodes(card).find(n => n.props.title === '打开会话').props['aria-expanded'], true)
  assert.deepEqual(nodes(card).filter(n => n.type === 'SelectItem').map(text), ['default · ' + title, 'dev · ' + title])
  button(card, '打开会话')()
  assert.equal(nodes(render()).filter(n => n.type === 'Select').length, 0)
  for (const profile of ['default', 'dev']) {
    button(render(), '打开会话')()
    await nodes(render()).find(n => n.type === 'Select').props.onValueChange(JSON.stringify([profile, 'stored']))
    assert.deepEqual(plain(h.calls.at(-1)), ['session', 'stored', { profile }])
    assert.equal(nodes(render()).filter(n => n.type === 'Select').length, 0)
  }
  h.host.openSession = async () => { throw new Error('profile unavailable') }
  button(render(), '打开会话')()
  await nodes(render()).find(n => n.type === 'Select').props.onValueChange(JSON.stringify(['dev', 'stored']))
  assert.match(h.notices.at(-1).message, /打开会话失败：profile unavailable/)
})
 test('stale backend notice explains gateway reload in board and dock', () => {
  for (const version of [undefined, 1, 3]) {
    for (const component of ['BoardPage', 'DockPanel']) {
      const h = harness()
      h.results['dev-board'].data.api_version = version
      const node = h.render(h.api[component])
      const notice = nodes(node).find(n => n.type === 'EmptyState')
      assert.match(notice.props.title, /版本不匹配/)
      assert.match(notice.props.description, /重启.*网关/)
    }
  }
 })
 test('detached review state explains branch requirement and prevents manual add', () => {
  const h = harness()
  h.results['dev-board-reviews'] = { data: { status: 'detached', reviews: [], manual: [], message: 'detached HEAD' } }
  const node = h.render(h.api.ReviewLinks, { repo: reviewRepo })
  assert.match(text(node), /无法推断来源分支/)
  assert.match(text(node), /手工关联均需/)
  assert.equal(nodes(node).find(n => n.props['aria-label'] === '为 api 添加链接').props.disabled, true)
  assert.doesNotMatch(text(node), /请求失败/)
 })

test('unsupported review remote explains configuration instead of branch switching', () => {
 const h = harness()
 h.results['dev-board-reviews'] = { data: { status: 'unsupported_source', branch: 'feat/exact', message: 'unsupported remote' } }
 const node = h.render(h.api.ReviewLinks, { repo: reviewRepo })
 assert.match(text(node), /remote.*不受支持/)
 assert.doesNotMatch(text(node), /先切换/)
})

test('empty dock keeps repository selection, one clean message and full task context', () => {
  const h = harness()
  h.results['dev-board'].data.tasks[0].repos = [reviewRepo]
  h.results['dev-board-task-changes'].data.repos = [{ ...reviewRepo, dirty: 0 }]
  let panel = h.render(h.api.DockPanel)
  assert.equal(nodes(panel).filter(n => n.props.className === 'db-context-title' && n.props.title === h.session.title).length, 1)
  assert.equal(nodes(panel).find(n => n.type === 'SelectItem' && n.props.value === '1234').props.children, h.session.title)
  assert.doesNotMatch(text(panel), /0 文件|0 变更|api（0）/)
  assert.equal(text(panel).split('无未提交变更').length - 1, 1)
  const selects = nodes(panel).filter(n => n.type === 'Select')
  selects[1].props.onValueChange('api')
  panel = h.render(h.api.DockPanel)
  assert.equal(nodes(panel).filter(n => n.type === 'Select')[1].props.value, 'api')
  assert.equal(nodes(panel).find(n => n.type === h.api.ReviewLinks).props.repo.repo, 'api')
  nodes(panel).find(n => n.type === 'Select').props.onValueChange('1234')
  assert.equal(nodes(h.render(h.api.DockPanel)).find(n => n.type === 'Select').props.value, '1234')
})

test('compact review counts require success and accessible actions preserve refresh and form errors', async () => {
  for (const status of [undefined, 'unsupported', 'unavailable', 'detached', 'unsupported_source', 'error', 'timeout', 'partial']) {
    const h = harness()
    h.results['dev-board-reviews'] = { data: { status } }
    const panel = h.render(h.api.ReviewLinks, { repo: reviewRepo, compact: true })
    assert.doesNotMatch(text(panel), /0 ·/)
    assert.equal(nodes(panel).find(n => n.props.className === 'db-review-name').props.children, 'api')
  }
  const h = harness()
  h.results['dev-board-reviews'] = { data: { status: 'empty' }, refetch: () => h.queries.at(-1).queryFn() }
  const render = () => h.render(h.api.ReviewLinks, { repo: reviewRepo, compact: true })
  let panel = render()
  assert.match(text(panel), /0 · 无关联审阅/)
  const action = label => nodes(panel).find(n => n.props['aria-label'] === label)
  assert.equal(action('刷新 api 审阅').props.title, '刷新 api 审阅')
  action('刷新 api 审阅').props.onClick()
  assert.match(h.calls.at(-1)[1], /force=true/)
  action('为 api 添加链接').props.onClick()
  panel = render()
  nodes(panel).find(n => n.type === 'input').props.onChange({ target: { value: 'https://host/review' } })
  panel = render()
  h.rest = async () => { throw new Error('write refused') }
  await nodes(panel).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} })
  panel = render()
  assert.equal(nodes(panel).find(n => n.props.role === 'alert').props.children, 'write refused')
  assert.ok(nodes(panel).some(n => n.type === 'form'))
})


test('dev board exposes one sidebar entry and no task list route', () => {
 const h = harness()
 assert.equal(h.registrations.filter(r => r.area === 'nav').length, 1)
 assert.ok(!h.registrations.some(r => r.data.path === '/tasks'))
})


test('board header, stats, table, collapse and review details follow workspace structure', () => {
  const h = harness()
  const repo = { ...reviewRepo, dirty: 3, last: 'abc123 Full commit subject', branch: 'feature/long/branch/name' }
  const task = { id: '1234', repos: [repo] }
  const render = (expanded = true) => h.render(h.api.TaskCard, { task, expanded })
  let card = render()
  assert.equal(nodes(card).filter(n => n.type === 'table').length, 1)
  assert.deepEqual(nodes(card).filter(n => n.type === 'th').map(text), ['仓库', '分支 + 最新提交', '合并请求', '目标分支', '状态', ''])
  assert.match(text(card), /3 未提交/)
  assert.equal(nodes(card).find(n => n.props.className === 'db-branch').props.title, repo.branch)
  assert.equal(nodes(card).find(n => n.props.className === 'db-hash').props.children, 'abc123')
  assert.equal(nodes(card).filter(n => n.type === h.api.ReviewLinks).length, 0)
  nodes(card).find(n => n.props['aria-label'] === 'api 审阅详情').props.onClick()
  card = render()
  assert.equal(nodes(card).find(n => n.props['aria-label'] === 'api 审阅详情').props['aria-haspopup'], 'dialog')
  assert.equal(nodes(card).find(n => n.type === 'Dialog').props.open, true)
  assert.equal(nodes(card).filter(n => n.props.className === 'db-detail-row').length, 0)
  assert.equal(nodes(card).find(n => n.type === h.api.ReviewLinks).props.repo, repo)
  card = render(false)
  assert.equal(nodes(card).filter(n => n.type === 'table').length, 0)
  assert.equal(nodes(card).find(n => n.props.className === 'db-task-toggle').props['aria-expanded'], false)
  const bh = harness()
  let board = bh.render(bh.api.BoardPage)
  assert.match(text(board), /WORKSPACE \/ TASKS & CODE.*跨仓任务工作区/)
  assert.match(text(board), /2\s+个任务\s+0\s+个关联仓库/)
  assert.doesNotMatch(text(board), /个待合并/)
  assert.deepEqual(nodes(board).filter(n => n.type === bh.api.TaskCard).map(n => n.props.expanded), [true, false])
  button(board, '全部折叠')()
  board = bh.render(bh.api.BoardPage)
  assert.ok(nodes(board).filter(n => n.type === bh.api.TaskCard).every(n => !n.props.expanded))
  nodes(board).find(n => n.props['aria-label'] === '搜索任务').props.onChange({ target: { value: '5678' } })
  board = bh.render(bh.api.BoardPage)
  assert.deepEqual(nodes(board).filter(n => n.type === bh.api.TaskCard).map(n => n.props.task.id), ['5678'])
})

test('review summaries drive merged, pending and draft table pills and status filters', () => {
  const h = harness()
  const task = { id: '1234', repos: [reviewRepo] }
  const reviewData = { [reviewRepo.dir]: { branch: reviewRepo.branch, data: { status: 'ok', reviews: [{ ...reviewDataFixture(), state: 'merged' }] } } }
  let card = h.render(h.api.TaskCard, { task, reviewData })
  assert.match(text(card), /已全部合并/)
  assert.match(text(card), /✓ 已合并/)
  assert.match(text(card), /1\/1 已合并/)
  reviewData[reviewRepo.dir].data.reviews[0].state = 'open'
  reviewData[reviewRepo.dir].data.reviews[0].draft = true
  card = h.render(h.api.TaskCard, { task, reviewData })
  assert.match(text(card), /需要处理/)
  assert.match(text(card), /草稿/)
  const bh = harness()
  bh.results['dev-board'].data.tasks[0].repos = [{ ...reviewRepo, dirty: 1 }]
  let board = bh.render(bh.api.BoardPage)
  nodes(board).find(n => n.type === 'select').props.onChange({ target: { value: 'pending' } })
  board = bh.render(bh.api.BoardPage)
  assert.deepEqual(nodes(board).filter(n => n.type === bh.api.TaskCard).map(n => n.props.task.id), ['1234'])
  const observer = nodes(board).find(n => typeof n.type === 'function' && n.type.name === 'BoardReviewObserver')
  observer.props.onData(reviewRepo.dir, reviewRepo.branch, { status: 'ok', reviews: [{ ...reviewDataFixture(), state: 'merged' }] }, false)
  board = bh.render(bh.api.BoardPage)
  assert.equal(nodes(board).filter(n => n.type === bh.api.TaskCard).length, 0)
  nodes(board).find(n => n.type === 'select').props.onChange({ target: { value: 'done' } })
  board = bh.render(bh.api.BoardPage)
  assert.deepEqual(nodes(board).filter(n => n.type === bh.api.TaskCard).map(n => n.props.task.id), ['1234'])
  nodes(board).find(n => n.props['aria-label'] === '搜索任务').props.onChange({ target: { value: 'api' } })
  assert.equal(nodes(bh.render(bh.api.BoardPage)).filter(n => n.type === bh.api.TaskCard).length, 1)
})
function reviewDataFixture() { return { provider: 'gitlab', number: 747, title: 'Review', target_branch: 'v3.6.5', url: 'https://gitlab.com/a/b/-/merge_requests/747' } }

test('review fields retain complete titles and distinguish open, merged and draft badges', () => {
  const h = harness()
  const title = '  Full MR title with trailing content  '
  h.results['dev-board-reviews'] = { data: { status: 'ok', reviews: [
    { ...reviewData.reviews[0], title },
    { ...reviewData.reviews[1], state: 'opened' },
    { ...reviewData.reviews[1], number: 9, state: 'open', draft: true }
  ] } }
  const panel = h.render(h.api.ReviewLinks, { repo: reviewRepo })
  const rows = nodes(panel).filter(n => n.props.className === 'db-review-link db-review-row')
  assert.equal(rows.length, 3)
  assert.equal(nodes(rows[0]).find(n => n.props.className === 'db-review-title').props.children, title)
  assert.equal(rows[0].props.title, title)
  assert.equal(nodes(rows[0]).find(n => n.props.className === 'db-review-id').type, 'strong')
  assert.equal(nodes(rows[0]).find(n => n.props.className === 'db-review-target').props.children, '→ main')
  for (const [i, cls, label] of [[0, 'merged', '已合并'], [1, 'open', '待合并'], [2, 'draft', '草稿']]) {
    assert.ok(nodes(rows[i]).some(n => n.props.className === 'db-review-badge db-review-' + cls && text(n).replace(/^▷ /, '').replace(/ ↗$/, '') === label))
  }
})


test('page title keeps intrinsic height in its column heading without changing dock flex', () => {
  const source = fs.readFileSync(path.join(__dirname, '../dev-board/desktop/plugin.js'), 'utf8')
  const styles = source.split('const boardStyles = `')[1].split('`')[0]
  const declarations = selector => Object.fromEntries(styles
    .slice(styles.indexOf(selector + ' {') + selector.length + 2)
    .split('}')[0].split(';').filter(rule => rule.trim())
    .map(rule => rule.trim().split(':').map(part => part.trim())))
  const heading = declarations('.dev-board.db-page .db-task-heading')
  const title = declarations('.dev-board.db-page .db-title')
  assert.equal(heading['flex-direction'], 'column')
  assert.equal(heading['min-width'], '0')
  assert.equal(heading.width, '100%')
  assert.equal(title.flex, '0 0 auto', 'column title must not inherit the global zero flex basis')
  assert.equal(title.width, '100%')
  assert.equal(title['min-height'], '1.5em')
  assert.equal(declarations('.dev-board.db-dock .db-dock-toolbar .db-title').flex, '1 1 0')
  const h = harness()
  const card = h.render(h.api.TaskCard, { task: { id: '1234', repos: [] } })
  const row = nodes(card).find(n => n.props.className === 'db-title')
  assert.match(text(row), /ZT-1234.*task/)
  assert.ok(nodes(row).some(n => n.props.className === 'db-ref'))
})

test('review details open a scoped native dialog, preserve repository identity and close through SDK state', () => {
  const h = harness()
  const repos = [reviewRepo, { ...reviewRepo, repo: 'web', dir: '/worktrees/web' }]
  const render = () => h.render(h.api.TaskCard, { task: { id: '1234', repos } })
  let card = render()
  let focused = 0, prevented = 0
  nodes(card).find(n => n.props['aria-label'] === 'web 审阅详情').props.onClick({ currentTarget: { focus: () => focused++ } })
  card = render()
  const dialogContent = nodes(card).find(n => n.type === 'DialogContent')
  assert.equal(dialogContent.props.className, 'dev-board db-dialog')
  dialogContent.props.onCloseAutoFocus({ preventDefault: () => prevented++ })
  assert.equal(focused, 1)
  assert.equal(prevented, 1)
  assert.equal(text(nodes(card).find(n => n.type === 'DialogTitle')), 'web · 代码审阅')
  assert.match(text(nodes(card).find(n => n.type === 'DialogDescription')), /ZT-1234/)
  assert.equal(nodes(card).find(n => n.type === h.api.ReviewLinks).props.repo.dir, '/worktrees/web')
  assert.match(text(card), /feat\/exact/)
  nodes(card).find(n => n.type === 'Dialog').props.onOpenChange(false)
  assert.ok(!nodes(render()).some(n => n.type === 'Dialog'))
  nodes(render()).find(n => n.props['aria-label'] === 'api 审阅详情').props.onClick()
  button(render(), '关闭')()
  assert.ok(!nodes(render()).some(n => n.type === 'Dialog'))
})

test('open repository details follow refreshed branch and commit by directory identity', () => {
  const h = harness()
  let selected = { ...reviewRepo, dir: '/second/api', last: 'abc123 original commit' }
  let task = { id: '1234', repos: [reviewRepo, selected] }
  const render = () => h.render(h.api.TaskCard, { task })
  let card = render()
  const triggers = nodes(card).filter(n => n.props['aria-label'] === 'api 审阅详情')
  triggers[1].props.onClick()
  card = render()
  assert.equal(nodes(card).find(n => n.type === h.api.ReviewLinks).props.repo, selected)

  for (const update of [
    { branch: 'feat/refreshed', last: 'def456 refreshed branch commit' },
    { branch: 'feat/refreshed', last: 'fed789 latest commit on same branch' }
  ]) {
    const previous = selected
    selected = { ...selected, ...update }
    task = { ...task, repos: [selected, { ...reviewRepo }] }
    card = render()
    const dialog = nodes(card).find(n => n.type === 'DialogContent')
    assert.ok(dialog, 'refresh keeps the selected repository dialog open')
    const paths = nodes(dialog).filter(n => n.props.className === 'db-dialog-path').map(text)
    assert.deepEqual(paths, [selected.dir, '⑂ ' + selected.branch])
    assert.equal(text(nodes(dialog).find(n => n.props.className === 'db-meta')), selected.last)
    assert.doesNotMatch(text(dialog), new RegExp(previous.last))
    const links = nodes(dialog).find(n => n.type === h.api.ReviewLinks)
    assert.equal(links.props.repo, selected, 'ReviewLinks receives the current repository object')
    assert.equal(links.props.showRepo, false)
  }
})

test('removed repository details close and stay closed when the directory returns', () => {
  const h = harness()
  const selected = { ...reviewRepo, dir: '/second/api' }
  let task = { id: '1234', repos: [reviewRepo, selected] }
  const render = () => h.render(h.api.TaskCard, { task })
  let card = render()
  nodes(card).filter(n => n.props['aria-label'] === 'api 审阅详情')[1].props.onClick()
  card = render()
  assert.equal(nodes(card).find(n => n.type === h.api.ReviewLinks).props.repo, selected)

  task = { ...task, repos: [{ ...reviewRepo }] }
  card = render()
  assert.ok(!nodes(card).some(n => n.type === 'Dialog'), 'removing the selected directory closes the dialog despite a same-name repository remaining')
  assert.ok(!nodes(card).some(n => n.type === h.api.ReviewLinks))

  const returned = { ...selected, branch: 'feat/returned', last: '123abc returned commit' }
  task = { ...task, repos: [reviewRepo, returned] }
  card = render()
  assert.ok(!nodes(card).some(n => n.type === 'Dialog'), 'readding the selected directory must not reopen the dialog')
  assert.ok(!nodes(card).some(n => n.type === h.api.ReviewLinks))
  nodes(card).filter(n => n.props['aria-label'] === 'api 审阅详情')[1].props.onClick()
  card = render()
  assert.equal(nodes(card).find(n => n.type === h.api.ReviewLinks).props.repo, returned, 'the returned repository can be explicitly opened')
  button(card, '关闭')()
  assert.ok(!nodes(render()).some(n => n.type === 'Dialog'))
})

test('Worktree help uses SDK dialog on unmatched sessions and dismisses without altering task selection', () => {
  const h = harness()
  h.state.focusedStoredSessionId.set('unknown')
  const render = () => h.render(h.api.DockPanel)
  let panel = render()
  nodes(panel).find(n => n.props['aria-label'] === '查看 Worktree 使用说明').props.onClick()
  panel = render()
  assert.equal(text(nodes(panel).find(n => n.type === 'DialogTitle')), 'Worktree 使用说明')
  assert.equal(nodes(panel).find(n => n.type === 'DialogContent').props.className, 'dev-board db-dialog')
  assert.match(text(panel), /手工链接状态未知/)
  nodes(panel).find(n => n.type === 'Dialog').props.onOpenChange(false)
  panel = render()
  assert.ok(!nodes(panel).some(n => n.type === 'Dialog'))
  assert.equal(nodes(panel).find(n => n.type === 'Select').props.value, 'auto')
  assert.ok(nodes(panel).some(n => n.props.title === '当前会话未匹配任务'))
})

test('full task identities remain distinct; manual selection survives focus changes and auto resumes following', () => {
  const h = harness()
  const other = { ...h.session, id: 'other', label: 'GH-5678', title: 'Another delivery' }
  h.results['dev-board-sessions'].data.zt_sessions['5678'] = [other]
  h.results['dev-board'].data.tasks[0].repos = [reviewRepo]
  const render = () => h.render(h.api.DockPanel)
  let panel = render()
  assert.deepEqual(nodes(panel).filter(n => n.type === 'SelectItem' && ['1234', '5678'].includes(n.props.value)).map(text), ['ZT-1234 task', 'GH-5678 · Another delivery'])
  nodes(panel).filter(n => n.type === 'Select')[1].props.onValueChange('api')
  panel = render()
  assert.equal(nodes(panel).filter(n => n.type === 'Select')[1].props.value, 'api')
  nodes(panel).find(n => n.type === 'Select').props.onValueChange('5678')
  panel = render()
  assert.equal(nodes(panel).filter(n => n.type === 'Select')[1].props.value, 'all')
  h.state.focusedStoredSessionId.set('unknown')
  panel = render()
  assert.equal(nodes(panel).find(n => n.type === 'Select').props.value, '5678')
  assert.match(text(panel), /当前选中 · GH-5678/)
  nodes(panel).find(n => n.type === 'Select').props.onValueChange('auto')
  assert.ok(nodes(render()).some(n => n.props.title === '当前会话未匹配任务'))
  h.state.focusedStoredSessionId.set('stored')
  assert.match(text(render()), /跟随会话 · ZT-1234/)
})

test('repository cards contain branch, changes and review together, with compacted directory selection', () => {
  const h = harness()
  h.results['dev-board'].data.tasks[0].repos = [reviewRepo]
  h.results['dev-board-task-changes'].data.files = [{ ...reviewRepo, path: 'src/nested/file.py', status: 'M', added: 3, removed: 2 }]
  const render = () => h.render(h.api.DockPanel)
  let panel = render()
  const card = nodes(panel).find(n => n.type === 'details')
  assert.equal(card.props.open, true)
  assert.match(text(card), /api.*1 文件.*feat\/exact.*文件变更.*PR\/MR/)
  assert.equal(nodes(card).find(n => n.type === h.api.ReviewLinks).props.repo.dir, reviewRepo.dir)
  const folder = nodes(card).find(n => n.props.row?.type === 'dir')
  assert.equal(folder.props.row.name, 'src/nested')
  folder.props.onToggle()
  panel = render()
  const file = nodes(panel).find(n => n.props.row?.type === 'file')
  assert.equal(file.props.row.path, 'src/nested/file.py')
  file.props.onPick()
  panel = render()
  assert.ok(nodes(panel).some(n => n.type.name === 'FileCompare'))
  assert.deepEqual(plain(h.queries.findLast(q => q.queryKey[0] === 'dev-board-diff').queryKey), ['dev-board-diff', reviewRepo.dir, 'src/nested/file.py'])
})

test('same repository name in distinct directories keeps each file and comparison identity', () => {
  const h = harness()
  const repos = [reviewRepo, { ...reviewRepo, dir: '/second/api' }]
  h.results['dev-board'].data.tasks[0].repos = repos
  h.results['dev-board-task-changes'].data.files = repos.map(repo => ({ ...repo, path: 'same.py', status: 'M', added: 1, removed: 0 }))
  let panel = h.render(h.api.DockPanel)
  const rows = nodes(panel).filter(n => n.props.row?.type === 'file')
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0].key, rows[1].key)
  rows[1].props.onPick()
  h.render(h.api.DockPanel)
  assert.deepEqual(plain(h.queries.findLast(q => q.queryKey[0] === 'dev-board-diff').queryKey), ['dev-board-diff', '/second/api', 'same.py'])
})

test('dock footer reports review counts honestly across loading, partial, empty and manual-link states', () => {
  const h = harness()
  h.results['dev-board'].data.tasks[0].repos = [reviewRepo]
  const render = () => h.render(h.api.DockPanel)
  const observe = (data, error = false) => {
    const observer = nodes(render()).find(n => typeof n.type === 'function' && n.type.name === 'BoardReviewObserver')
    observer.props.onData(reviewRepo.dir, reviewRepo.branch, data, error)
    return render()
  }
  assert.match(text(render()), /合并进度未知/)
  let panel = observe({ status: 'ok', reviews: reviewData.reviews })
  assert.match(text(panel), /1 \/ 2 个审阅已合并/)
  assert.equal(nodes(panel).find(n => n.props.role === 'progressbar').props['aria-valuenow'], 1)
  for (const [data, error] of [[{ ...reviewData, status: 'partial' }, false], [{ status: 'empty' }, true], [reviewData, false]]) {
    panel = observe(data, error)
    assert.match(text(panel), /合并进度未知/)
    assert.ok(!nodes(panel).some(n => n.props.role === 'progressbar'))
  }
  panel = observe({ status: 'empty', reviews: [], manual: [] })
  assert.match(text(panel), /无关联审阅/)
  assert.ok(!nodes(panel).some(n => n.props.role === 'progressbar'))
  button(panel, '仓库视图 →')()
  assert.deepEqual(plain(h.calls.at(-1)), ['navigate', '/dev-board'])
})

test('file comparison loading and errors remain explicit and support returning to repository cards', () => {
  const h = harness()
  h.results['dev-board'].data.tasks[0].repos = [reviewRepo]
  h.results['dev-board-task-changes'].data.files = [{ ...reviewRepo, path: 'file.py', status: 'M', added: 1, removed: 0 }]
  const render = () => h.render(h.api.DockPanel)
  nodes(render()).find(n => n.props.row?.type === 'file').props.onPick()
  h.results['dev-board-diff'] = { isLoading: true }
  assert.ok(nodes(render()).some(n => n.props.title === '加载文件差异…'))
  h.results['dev-board-diff'] = { isError: true, error: new Error('diff unavailable') }
  let panel = render()
  assert.ok(nodes(panel).some(n => n.props.title === '文件差异加载失败' && n.props.description === 'diff unavailable'))
  button(panel, '← 返回')()
  assert.ok(nodes(render()).some(n => n.type === 'details'))
})

test('board navigation uses host route and search matches actual review title, number and branch', () => {
  const h = harness()
  h.results['dev-board'].data.tasks[0].repos = [reviewRepo]
  const render = () => h.render(h.api.BoardPage)
  let panel = render()
  button(panel, '▦ 任务清单')()
  assert.deepEqual(plain(h.calls.at(-1)), ['navigate', '/tasks'])
  assert.equal(nodes(panel).find(n => n.props['aria-current'] === 'page').props.children, '⑂ 仓库视图')
  const observer = nodes(panel).find(n => typeof n.type === 'function' && n.type.name === 'BoardReviewObserver')
  observer.props.onData(reviewRepo.dir, reviewRepo.branch, { status: 'ok', reviews: [reviewDataFixture()] }, false)
  for (const query of ['747', 'Review', 'feat/exact', 'v3.6.5']) {
    nodes(render()).find(n => n.props['aria-label'] === '搜索任务').props.onChange({ target: { value: query } })
    assert.deepEqual(nodes(render()).filter(n => n.type === h.api.TaskCard).map(n => n.props.task.id), ['1234'])
  }
})
