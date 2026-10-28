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

function harness(saved = new Map()) {
  const notices = [], calls = [], queries = [], registrations = [], cleanups = []
  const state = {
    focusedStoredSessionId: atom('stored'), focusedSessionId: atom('runtime'),
    focusedSessionProfile: atom('dev'), profile: atom('default')
  }
  const results = {}
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
    navigate(route) { calls.push(['navigate', route]) }
  }
  const slots = []
  let cursor = 0, pending = [], dirty = false
  const jsx = (type, props, key) => {
    if (type === 'EmptyState') assert.equal(props.hint, undefined, 'SDK EmptyState supports description, not hint')
    return { type, props: props || {}, key }
  }
  const context = vm.createContext({
    console: { error: (...args) => calls.push(['console.error', ...args]) }, URL, host, jsx, jsxs: jsx, cn: (...args) => args.filter(Boolean).join(' '),
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
      'SelectTrigger', 'SelectValue', 'StatusDot', 'Dialog', 'DialogTrigger', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem'].map((name) => [name, name]))
  })
  const source = fs.readFileSync(path.join(__dirname, '../task-board/desktop/plugin.js'), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export default {', 'globalThis.plugin = {')
  vm.runInContext(source + '\nglobalThis.api = { TasksPage, startTaskSession, taskSessionTitle };', context)
  const h = {
    saved, api: context.api, state, host, notices, calls, queries, results, registrations,
    unload() { cleanups.forEach((fn) => fn()) },
    rest: async (url, options) => {
      calls.push(['rest', url, options])
      return url === '/tasks' && !options ? { api_version: 1, tasks: [] } : { ok: true }
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
  context.plugin.register({ storage: { get: (key, fallback) => saved.has(key) ? saved.get(key) : fallback, set: (key, value) => saved.set(key, value) }, onDispose: (fn) => cleanups.push(fn), os: { openExternal: async (url) => { calls.push(['external', url]); return true } }, rest: (...args) => h.rest(...args), register: (entry) => registrations.push(entry) })
  return h
}

function nodes(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(nodes)
  return [node, ...nodes(node.props?.children)]
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ')
  if (node && typeof node === 'object') return node.type === 'style' ? '' : text(node.props?.children)
  return node == null ? '' : String(node)
}
function button(node, label) {
  const found = nodes(node).find((n) => n.type === 'Button' && text(n) === label)
  assert.ok(found, 'button: ' + label)
  return found.props.onClick
}
const plain = (value) => JSON.parse(JSON.stringify(value))

const todoTask = { id: '10', title: 'Ship feature', ref: 'GH-1234', note: 'remember this', pinned: false, status: 'todo', order: 0 }
function tasksHarness(tasks = [todoTask]) {
  const h = harness()
  h.results['task-board-labels'] = { data: { labels: {} }, refetch: async () => {} }
  h.results['task-board-tasks'] = { data: { api_version: 1, tasks }, refetch: async () => {} }
  h.renderTasks = () => h.render(h.api.TasksPage)
  return h
}

test('task page registers route, nav and palette; renders backend data and empty state', async () => {
  const h = tasksHarness()
  assert.equal(h.registrations.find(r => r.id === 'tasks-page').data.path, '/tasks')
  assert.equal(h.registrations.find(r => r.id === 'tasks-nav').data.label, 'Task Board')
  assert.equal(h.registrations.find(r => r.id === 'tasks-nav').data.codicon, 'checklist')
  assert.equal(h.registrations.find(r => r.id === 'tasks-open').data.label, 'Task Board：打开任务清单')
  assert.match(text(h.renderTasks()), /Ship feature.*remember this.*GH-1234/)
  await h.queries.find(q => q.queryKey[0] === 'task-board-tasks').queryFn()
  assert.equal(h.calls.at(-1)[1], '/tasks')
  assert.equal(nodes(tasksHarness([]).renderTasks()).filter(n => n.type === 'section').length, 3)
})

test('task status and delete call backend; pin and reorder retain backend ownership', async () => {
  const h = tasksHarness()
  await nodes(h.renderTasks()).find(n => n.props['aria-label'] === '切换状态 Ship feature').props.onClick()
  assert.deepEqual(plain(h.calls.at(-1)), ['rest', '/tasks/10', { method: 'PATCH', body: { status: 'doing' } }])
  await button(h.renderTasks(), '置顶')()
  assert.equal(h.calls.at(-1)[2].body.pinned, true)
  await button(h.renderTasks(), '↑')()
  assert.deepEqual(plain(h.calls.at(-1)[2]), { method: 'POST', body: { direction: 'up' } })
  await button(h.renderTasks(), '删除')()
  assert.equal(h.calls.at(-1)[2].method, 'POST')
  await button(h.renderTasks(), '确认删除')()
  assert.deepEqual(plain(h.calls.at(-1)), ['rest', '/tasks/10', { method: 'DELETE' }])
})

test('task filters and search are client-side, pinned rows sort first', () => {
  const h = tasksHarness([todoTask, { ...todoTask, id: '11', title: 'Finished', note: '', status: 'done', pinned: true }])
  let panel = h.renderTasks()
  assert.match(text(nodes(panel).find(n => n.type === 'section' && n.props['aria-label'] === '已完成')), /Finished/)
  button(panel, '☰ 列表')()
  nodes(h.renderTasks()).find(n => n.props.role === 'tab' && text(n) === '已完成').props.onClick()
  panel = h.renderTasks()
  assert.match(text(panel), /Finished/)
  assert.doesNotMatch(text(panel), /Ship feature/)
  nodes(panel).find(n => n.props.role === 'tab' && text(n) === '全部').props.onClick()
  nodes(h.renderTasks()).find(n => n.props.type === 'search').props.onChange({ target: { value: 'REMEMBER' } })
  assert.match(text(h.renderTasks()), /Ship feature/)
  assert.doesNotMatch(text(h.renderTasks()), /Finished/)
  assert.equal(h.calls.length, 0)
})

test('task start creates real titled session on current gateway, then reuses saved session', async () => {
  const h = tasksHarness()
  const node = h.renderTasks()
  await button(node, '▷ 开始任务')()
  const rpc = h.calls.filter(c => c[0] === 'rpc')
  assert.deepEqual(plain(rpc), [
    ['rpc', 'session.create', { title: 'GH-1234 Ship feature' }]
  ])
  const saved = h.calls.find(c => c[0] === 'rest')[2].body
  assert.equal(saved.session_profile, 'default') // active gateway, not focused chat's dev profile
  assert.equal(h.calls.at(-1)[2].body.status, 'doing')
  assert.deepEqual(plain(h.calls.find(c => c[0] === 'session')), ['session', 'stored-task', { profile: 'default' }])
  await button(h.renderTasks(), '▷ 开始任务')()
  assert.equal(h.calls.filter(c => c[1] === 'session.create').length, 1)
  const other = tasksHarness([{ ...todoTask, session_id: 'existing', session_profile: 'work' }])
  await button(other.renderTasks(), '▷ 开始任务')()
  assert.deepEqual(plain(other.calls.find(c => c[0] === 'session')), ['session', 'existing', { profile: 'work' }])
  assert.equal(other.calls.filter(c => c[0] === 'rpc').length, 0)
})

test('task creation/edit form writes fields and URL uses OS opener', async () => {
  const h = tasksHarness([{ ...todoTask, url: 'https://zt.example/task/1234' }])
  await button(h.renderTasks(), 'GH-1234')()
  assert.deepEqual(plain(h.calls.at(-1)), ['external', 'https://zt.example/task/1234'])
  button(h.renderTasks(), '＋新建任务')()
  let panel = h.renderTasks()
  nodes(panel).find(n => n.props['aria-label'] === '标题').props.onChange({ target: { value: 'New task' } })
  panel = h.renderTasks()
  await nodes(panel).find(n => n.props.className === 'tb-task-form').props.onSubmit({ preventDefault() {} })
  assert.equal(h.calls.at(-1)[1], '/tasks')
  assert.equal(h.calls.at(-1)[2].body.title, 'New task')
  assert.equal(h.api.taskSessionTitle({ ...todoTask, ref: '1234' }), '1234 Ship feature')
  assert.equal(h.api.taskSessionTitle({ ...todoTask, ref: '' }), 'Ship feature')
})

test('GH reference and URL roundtrip through form and titled session without parsing', async () => {
  const h = tasksHarness([])
  button(h.renderTasks(), '＋新建任务')()
  for (const [label, value] of [['标题', 'fix login'], ['任务编号(ref)', 'GH-12'], ['链接(url)', 'https://github.com/example/repo/issues/12']]) {
    nodes(h.renderTasks()).find(n => n.props['aria-label'] === label).props.onChange({ target: { value } })
  }
  await nodes(h.renderTasks()).find(n => n.props.className === 'tb-task-form').props.onSubmit({ preventDefault() {} })
  const body = plain(h.calls.at(-1)[2].body)
  assert.deepEqual(body, { title: 'fix login', ref: 'GH-12', note: '', url: 'https://github.com/example/repo/issues/12', labels: [] })
  h.results['task-board-tasks'].data.tasks = [{ ...todoTask, ...body }]
  button(h.renderTasks(), '编辑')()
  assert.equal(nodes(h.renderTasks()).find(n => n.props['aria-label'] === '任务编号(ref)').props.value, body.ref)
  assert.equal(nodes(h.renderTasks()).find(n => n.props['aria-label'] === '链接(url)').props.value, body.url)
  await button(h.renderTasks(), '▷ 开始任务')()
  assert.deepEqual(plain(h.calls.find(c => c[0] === 'rpc')), ['rpc', 'session.create', { title: 'GH-12 fix login' }])
  for (const ref of ['ZT-1234', 'JIRA-100', 'anything', '7']) assert.equal(h.api.taskSessionTitle({ title: 'fix login', ref }), ref + ' fix login')
})

test('task start failures stay visible and retries retain the created identity', async () => {
  const h = tasksHarness()
  let refuse = true
  const originalRest = h.rest
  h.rest = async (...args) => {
    if (refuse) throw new Error('save refused')
    return originalRest(...args)
  }
  await button(h.renderTasks(), '▷ 开始任务')()
  assert.equal(nodes(h.renderTasks()).find(n => n.props.role === 'alert').props.children, 'save refused')
  assert.equal(h.calls.filter(c => c[0] === 'session').length, 0)
  refuse = false
  await button(h.renderTasks(), '▷ 开始任务')()
  assert.equal(h.calls.filter(c => c[1] === 'session.create').length, 1)
  assert.equal(h.calls.find(c => c[0] === 'session')[1], 'stored-task')
  const failed = tasksHarness()
  failed.host.getGateway = () => ({ request: async () => { throw new Error('create failed') } })
  await button(failed.renderTasks(), '▷ 开始任务')()
  assert.equal(nodes(failed.renderTasks()).find(n => n.props.role === 'alert').props.children, 'create failed')
  assert.equal(failed.calls.length, 0)
})

test('task launch ignores concurrent stale clicks and marks doing only after open succeeds', async () => {
  const h = tasksHarness()
  let finish
  h.host.getGateway = () => ({ request: () => new Promise(resolve => { finish = resolve }) })
  const launch = button(h.renderTasks(), '▷ 开始任务')
  const pending = launch()
  await launch()
  finish({ stored_session_id: 'one', session_id: 'runtime-one' })
  await pending
  assert.equal(h.calls.filter(c => c[0] === 'session').length, 1)
  const failed = tasksHarness()
  failed.host.openSession = async () => { throw new Error('open failed') }
  await button(failed.renderTasks(), '▷ 开始任务')()
  assert.equal(failed.calls.filter(c => c[0] === 'rest').length, 1)
  assert.equal(failed.calls.find(c => c[0] === 'rest')[2].body.status, undefined)
  assert.equal(nodes(failed.renderTasks()).find(n => n.props.role === 'alert').props.children, 'open failed')
})


test('native task drag changes status, refreshes groups and clears drag feedback', async () => {
  const h = tasksHarness()
  const query = h.results['task-board-tasks']
  let refreshes = 0
  query.refetch = async () => { refreshes++; query.data.tasks = [{ ...todoTask, status: 'doing' }] }
  const data = new Map()
  const event = { dataTransfer: { setData: (key, value) => data.set(key, value), getData: key => data.get(key) }, preventDefault() { this.prevented = true } }
  const row = panel => nodes(panel).find(n => n.props.draggable === true)
  const zone = (panel, label) => nodes(panel).find(n => n.type === 'section' && n.props['aria-label'] === label)
  row(h.renderTasks()).props.onDragStart(event)
  assert.equal(data.get('text/plain'), todoTask.id)
  assert.equal(event.dataTransfer.effectAllowed, 'move')
  assert.match(row(h.renderTasks()).props.className, /tb-dragging/)
  zone(h.renderTasks(), '进行中').props.onDragOver(event)
  assert.equal(event.prevented, true)
  assert.equal(event.dataTransfer.dropEffect, 'move')
  assert.match(zone(h.renderTasks(), '进行中').props.className, /tb-drop-target/)
  await zone(h.renderTasks(), '进行中').props.onDrop(event)
  assert.deepEqual(plain(h.calls.at(-1)), ['rest', '/tasks/10', { method: 'PATCH', body: { status: 'doing' } }])
  assert.equal(refreshes, 1)
  const panel = h.renderTasks()
  assert.doesNotMatch(text(zone(panel, '待办')), /Ship feature/)
  assert.match(text(zone(panel, '进行中')), /Ship feature/)
  assert.doesNotMatch(row(panel).props.className, /tb-dragging/)
  row(panel).props.onDragStart(event)
  event.prevented = false
  zone(h.renderTasks(), '进行中').props.onDragOver(event)
  assert.equal(event.prevented, false)
  await zone(h.renderTasks(), '进行中').props.onDrop(event)
  assert.equal(h.calls.length, 1)
  row(h.renderTasks()).props.onDragStart(event)
  row(h.renderTasks()).props.onDragEnd()
  await zone(h.renderTasks(), '已完成').props.onDrop(event)
  assert.equal(h.calls.length, 1)
})

test('task plugin has no dev-board runtime references and has one sidebar entry', () => {
  const source = fs.readFileSync(path.join(__dirname, '../task-board/desktop/plugin.js'), 'utf8')
  assert.doesNotMatch(source, /ctx\.rest\([^)]*dev-board|DEV_BOARD|dev-board-tasks/)
  assert.equal(harness().registrations.filter(r => r.area === 'nav').length, 1)
})

test('task edit submits existing identity and palette navigates independently', async () => {
  const h = tasksHarness()
  button(h.renderTasks(), '编辑')()
  nodes(h.renderTasks()).find(n => n.props['aria-label'] === '标题').props.onChange({ target: { value: 'Edited task' } })
  await nodes(h.renderTasks()).find(n => n.props.className === 'tb-task-form').props.onSubmit({ preventDefault() {} })
  assert.equal(h.calls.at(-1)[1], '/tasks/10')
  assert.equal(h.calls.at(-1)[2].method, 'PATCH')
  assert.equal(h.calls.at(-1)[2].body.title, 'Edited task')
  h.registrations.find(r => r.id === 'tasks-open').data.run()
  assert.deepEqual(plain(h.calls.at(-1)), ['navigate', '/tasks'])
})


test('colored labels roundtrip in task form and combine with status and search', async () => {
  const h = tasksHarness([
    { ...todoTask, labels: ['bug'] },
    { ...todoTask, id: '11', status: 'done', labels: ['bug'], title: 'Done ship' },
    { ...todoTask, id: '12', labels: ['docs'], title: 'Other' }
  ])
  h.results['task-board-labels'].data.labels = { bug: 'red', docs: 'blue' }
  const row = panel => nodes(panel).filter(n => /(?:^| )tb-task-row(?: |$)/.test(n.props.className || ''))
  assert.equal(nodes(row(h.renderTasks())[0]).find(n => n.props.className === 'tb-label-dot').props.style.backgroundColor, 'var(--ui-red)')
  nodes(h.renderTasks()).find(n => n.props['aria-label'] === '标签筛选').props.onChange({ target: { value: 'bug' } })
  assert.equal(row(h.renderTasks()).length, 2)
  button(h.renderTasks(), '☰ 列表')()
  nodes(h.renderTasks()).find(n => n.props.role === 'tab' && text(n) === '待办').props.onClick()
  nodes(h.renderTasks()).find(n => n.props.type === 'search').props.onChange({ target: { value: 'REMEMBER' } })
  assert.equal(row(h.renderTasks()).length, 1)
  nodes(h.renderTasks()).find(n => n.props.type === 'search').props.onChange({ target: { value: 'absent' } })
  assert.equal(row(h.renderTasks()).length, 0)
  nodes(h.renderTasks()).find(n => n.props.type === 'search').props.onChange({ target: { value: '' } })
  button(h.renderTasks(), '编辑')()
  const choice = name => nodes(h.renderTasks()).find(n => n.props.className === 'tb-label-choice' && text(n).trim() === name)
  assert.equal(choice('bug').props['aria-pressed'], true)
  choice('docs').props.onClick()
  await nodes(h.renderTasks()).find(n => n.props.className === 'tb-task-form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(plain(h.calls.at(-1)[2].body.labels), ['bug', 'docs'])
})

test('label manager renders eight palette colors and calls create rename color and delete APIs', async () => {
  const h = tasksHarness()
  h.results['task-board-labels'].data.labels = { bug: 'red' }
  button(h.renderTasks(), '管理标签')()
  const form = name => nodes(h.renderTasks()).find(n => n.type === 'form' && n.props['aria-label'] === name)
  const colors = nodes(form('新建标签')).filter(n => n.type === 'button')
  assert.equal(colors.length, 8)
  assert.equal(new Set(colors.map(n => n.props.children.props.style.backgroundColor)).size, 8)
  nodes(form('新建标签')).find(n => n.type === 'input').props.onChange({ target: { value: 'docs' } })
  colors.find(n => n.props['aria-label'] === 'teal').props.onClick()
  await form('新建标签').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(plain(h.calls.at(-1)), ['rest', '/labels', { method: 'POST', body: { name: 'docs', color: 'teal' } }])
  nodes(form('管理标签 bug')).find(n => n.type === 'input').props.onChange({ target: { value: 'fix' } })
  nodes(form('管理标签 bug')).find(n => n.props['aria-label'] === 'violet').props.onClick()
  await form('管理标签 bug').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(plain(h.calls.at(-1)), ['rest', '/labels', { method: 'PATCH', body: { name: 'bug', new_name: 'fix', color: 'violet' } }])
  await nodes(form('管理标签 bug')).find(n => n.props['aria-label'] === '删除标签 bug').props.onClick()
  assert.deepEqual(plain(h.calls.at(-1)), ['rest', '/labels?name=bug', { method: 'DELETE' }])
})


test('label manager supports names that collide with Object prototype keys', async () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    const h = tasksHarness()
    h.results['task-board-labels'].data.labels = JSON.parse('{"' + name + '":"blue"}')
    button(h.renderTasks(), '管理标签')()
    const form = () => nodes(h.renderTasks()).find(n => n.type === 'form' && n.props['aria-label'] === '管理标签 ' + name)
    assert.equal(nodes(form()).find(n => n.type === 'input').props.value, name)
    assert.equal(nodes(form()).find(n => n.props['aria-label'] === 'blue').props['aria-pressed'], true)
    nodes(form()).find(n => n.type === 'input').props.onChange({ target: { value: 'renamed' } })
    await form().props.onSubmit({ preventDefault() {} })
    assert.deepEqual(plain(h.calls.at(-1)[2].body), { name, new_name: 'renamed', color: 'blue' })
  }
})

test('labels 404 shows actionable stale banner without raw JSON and keeps console error', async () => {
  const h = tasksHarness()
  h.renderTasks()
  const raw = '404: {"detail":"Not Found"}'
  h.rest = async () => { throw new Error(raw) }
  let failure
  try { await h.queries.find(q => q.queryKey[0] === 'task-board-labels').queryFn() } catch (error) { failure = error }
  h.results['task-board-tasks'].error = new Error('500: unavailable')
  h.results['task-board-labels'] = { isError: true, error: failure }
  const panel = h.renderTasks()
  assert.equal(text(nodes(panel).find(n => n.props.role === 'alert')), '后端为旧版本：需重启/重载网关后生效')
  assert.doesNotMatch(text(panel), /404|Not Found|detail/)
  assert.equal(h.calls.find(c => c[0] === 'console.error')[3].message, raw)
})

test('labels-only failure keeps loaded tasks visible in board and list with fallback label colors', async () => {
  for (const view of ['board', 'list']) {
    const h = tasksHarness([{ ...todoTask, labels: ['bug'] }])
    h.renderTasks()
    h.rest = async () => { throw new Error('503: labels unavailable') }
    let failure
    try { await h.queries.find(q => q.queryKey[0] === 'task-board-labels').queryFn() } catch (error) { failure = error }
    assert.equal(failure?.message, '503: labels unavailable')
    h.results['task-board-labels'] = { isError: true, error: failure }
    if (view === 'list') button(h.renderTasks(), '☰ 列表')()
    const panel = h.renderTasks()
    assert.equal(text(nodes(panel).find(n => n.props.role === 'alert')), failure.message)
    const row = nodes(panel).find(n => n.props.className === 'tb-task-row')
    assert.ok(row, view + ' retains the loaded task')
    assert.match(text(row), /Ship feature.*bug/)
    assert.equal(nodes(row).find(n => n.props.className === 'tb-label-dot').props.style.backgroundColor, 'var(--ui-text-tertiary)')
    assert.equal(nodes(panel).filter(n => n.type === 'section').length, view === 'board' ? 3 : 0)
    assert.equal(h.calls.find(c => c[0] === 'console.error')[1], 'Task Board request failed:')
  }
})

test('labels recover through refresh without losing task filters or hiding cached tasks', async () => {
  for (const view of ['board', 'list']) {
    const h = tasksHarness([{ ...todoTask, labels: ['bug'] }, { ...todoTask, id: '11', title: 'Other', labels: ['docs'] }])
    h.results['task-board-labels'].data.labels = { bug: 'red', docs: 'blue' }
    if (view === 'list') button(h.renderTasks(), '☰ 列表')()
    nodes(h.renderTasks()).find(n => n.props['aria-label'] === '标签筛选').props.onChange({ target: { value: 'bug' } })
    nodes(h.renderTasks()).find(n => n.props.type === 'search').props.onChange({ target: { value: 'Ship' } })
    const labels = h.results['task-board-labels']
    labels.error = new Error('503: labels unavailable'); labels.isError = true
    let panel = h.renderTasks()
    assert.match(text(panel), /Ship feature/)
    assert.doesNotMatch(text(panel), /Other/)
    const dot = panel => nodes(nodes(panel).find(n => n.props.className === 'tb-task-row')).find(n => n.props.className === 'tb-label-dot')
    assert.equal(dot(panel).props.style.backgroundColor, 'var(--ui-red)', 'cached label metadata remains usable')
    h.rest = async url => {
      assert.equal(url, '/labels')
      return { labels: { bug: 'teal', docs: 'blue' } }
    }
    labels.refetch = async () => {
      labels.data = await h.queries.find(q => q.queryKey[0] === 'task-board-labels').queryFn()
      labels.error = null; labels.isError = false
    }
    await nodes(panel).find(n => n.props['aria-label'] === '刷新').props.onClick()
    panel = h.renderTasks()
    assert.equal(nodes(panel).some(n => n.props.role === 'alert'), false)
    assert.equal(nodes(panel).filter(n => n.props.className === 'tb-task-row').length, 1)
    assert.equal(dot(panel).props.style.backgroundColor, 'var(--ui-cyan)')
    assert.equal(nodes(panel).find(n => n.props['aria-label'] === '标签筛选').props.value, 'bug')
    assert.equal(nodes(panel).find(n => n.props.type === 'search').props.value, 'Ship')
  }
})

test('cached tasks remain visible after a failed refetch in board and list, then recover', async () => {
  for (const view of ['board', 'list']) {
    const h = tasksHarness()
    if (view === 'list') button(h.renderTasks(), '☰ 列表')()
    const query = h.results['task-board-tasks']
    let unavailable = true
    h.rest = async () => {
      if (unavailable) throw new Error('503: tasks unavailable')
      return { api_version: 1, tasks: [{ ...todoTask, title: 'Recovered task' }] }
    }
    query.refetch = async () => {
      try {
        query.data = await h.queries.find(q => q.queryKey[0] === 'task-board-tasks').queryFn()
        query.error = null; query.isError = false
      } catch (error) { query.error = error; query.isError = true }
    }
    await nodes(h.renderTasks()).find(n => n.props['aria-label'] === '刷新').props.onClick()
    let panel = h.renderTasks()
    assert.equal(text(nodes(panel).find(n => n.props.role === 'alert')), '503: tasks unavailable')
    assert.match(text(panel), /Ship feature/, view + ' retains cached tasks after refetch failure')
    assert.equal(nodes(panel).filter(n => n.props.className === 'tb-task-row').length, 1)
    unavailable = false
    await nodes(panel).find(n => n.props['aria-label'] === '刷新').props.onClick()
    panel = h.renderTasks()
    assert.match(text(panel), /Recovered task/)
    assert.doesNotMatch(text(panel), /Ship feature/)
    assert.equal(nodes(panel).some(n => n.props.role === 'alert'), false)
  }
})

test('tasks API version mismatch or absent version shows stale banner; matching version stays normal', async () => {
  for (const view of ['board', 'list']) {
    for (const version of [undefined, 0, 2]) {
      const h = tasksHarness()
      if (view === 'list') button(h.renderTasks(), '☰ 列表')()
      h.rest = async () => ({ api_version: version, tasks: [] })
      h.renderTasks()
      await assert.rejects(h.queries.find(q => q.queryKey[0] === 'task-board-tasks').queryFn(), /后端为旧版本/)
      h.results['task-board-tasks'].data.api_version = version
      h.results['task-board-tasks'].error = new Error('503: tasks unavailable')
      const panel = h.renderTasks()
      assert.match(text(nodes(panel).find(n => n.props.role === 'alert')), /需重启\/重载网关后生效/)
      assert.doesNotMatch(text(panel), /Ship feature/)
      assert.equal(nodes(panel).some(n => n.props.className === 'tb-task-columns' || n.props.className === 'tb-task-list'), false)
    }
  }
  const failed = tasksHarness()
  failed.results['task-board-tasks'] = { isError: true, error: new Error('503: tasks unavailable') }
  const panel = failed.renderTasks()
  assert.equal(text(nodes(panel).find(n => n.props.role === 'alert')), '503: tasks unavailable')
  assert.equal(nodes(panel).some(n => n.props.className === 'tb-task-columns' || n.props.className === 'tb-task-list'), false)
  assert.equal(nodes(tasksHarness().renderTasks()).some(n => n.props.role === 'alert'), false)
})

test('mutation 404 uses shared stale notice and empty board retains all columns', async () => {
  const h = tasksHarness()
  h.rest = async () => { throw Object.assign(new Error('Not Found'), { status: 404 }) }
  await button(h.renderTasks(), '删除')()
  await button(h.renderTasks(), '确认删除')()
  assert.match(text(nodes(h.renderTasks()).find(n => n.props.role === 'alert')), /后端为旧版本/)
  const empty = tasksHarness([]).renderTasks()
  assert.equal(nodes(empty).filter(n => n.type === 'EmptyState').length, 0)
  assert.equal(nodes(empty).filter(n => n.type === 'section').length, 3)
  const panel = tasksHarness().renderTasks()
  assert.equal(nodes(panel).filter(n => n.type === 'section').length, 3)
  assert.equal(nodes(panel).find(n => n.props['aria-label'] === '刷新').props.children, '↻')
  assert.match(text(panel), /全部标签/)
})

test('header, compact cards and column create controls follow task board structure', async () => {
  const h = tasksHarness([{ ...todoTask, created_at: new Date().toISOString() }])
  const panel = h.renderTasks()
  assert.equal(text(nodes(panel).find(n => n.type === 'h1')), '任务清单')
  assert.match(text(nodes(panel).find(n => n.type === 'header')), /TASK BOARD.*任务清单.*＋新建任务/)
  assert.equal(nodes(panel).find(n => n.props.type === 'search').props.placeholder, '搜索任务名称…')
  assert.equal(nodes(panel).find(n => n.type === 'Button' && n.props['aria-label'] === '任务操作 Ship feature').props.children, '···')
  assert.equal(text(nodes(panel).find(n => n.type === 'time')), '刚刚')
  for (const [status, label] of Object.entries({ todo: '待办', doing: '进行中', done: '已完成' })) {
    nodes(h.renderTasks()).find(n => n.props['aria-label'] === '新建' + label + '任务').props.onClick()
    nodes(h.renderTasks()).find(n => n.props['aria-label'] === '标题').props.onChange({ target: { value: 'Preset' } })
    await nodes(h.renderTasks()).find(n => n.props.className === 'tb-task-form').props.onSubmit({ preventDefault() {} })
    assert.equal(h.calls.at(-1)[2].body.status, status)
  }
  assert.equal(nodes(panel).filter(n => n.props.className === 'tb-add-task').length, 3)
})

test('list shares task filters and actions and saves view for a fresh page mount', async () => {
  const h = tasksHarness([todoTask, { ...todoTask, id: '11', title: 'Finished', status: 'done', session_id: 'saved', session_profile: 'dev' }])
  assert.equal(nodes(h.renderTasks()).find(n => n.props.role === 'radio' && text(n) === '▦ 看板').props['aria-checked'], true)
  button(h.renderTasks(), '☰ 列表')()
  assert.equal(h.saved.get('view'), 'list')
  let panel = h.renderTasks()
  assert.equal(nodes(panel).filter(n => n.type === 'section').length, 0)
  const list = nodes(panel).find(n => n.props['aria-label'] === '任务列表')
  assert.match(text(list), /Ship feature.*GH-1234.*待办.*Finished.*已完成/)
  await button(list, '打开会话')()
  assert.deepEqual(plain(h.calls.at(-1)), ['session', 'saved', { profile: 'dev' }])
  assert.equal(h.calls.filter(c => c[0] === 'rest').length, 0)
  nodes(panel).find(n => n.props.type === 'search').props.onChange({ target: { value: 'Finished' } })
  assert.doesNotMatch(text(h.renderTasks()), /Ship feature/)
  assert.equal(nodes(h.renderTasks()).filter(n => n.type === 'EmptyState').length, 0)
  const fresh = harness(h.saved)
  assert.equal(nodes(fresh.render(fresh.api.TasksPage)).find(n => n.props.role === 'radio' && text(n) === '☰ 列表').props['aria-checked'], true)
  button(fresh.render(fresh.api.TasksPage), '▦ 看板')()
  assert.equal(fresh.saved.get('view'), 'board')
})

test('label manager keeps its asChild trigger mounted when opened and closed, without writes or lost filters', () => {
  const h = tasksHarness()
  let panel = h.renderTasks()
  const assertTrigger = panel => {
    const dialog = nodes(panel).find(n => n.type === 'Dialog')
    assert.ok(dialog, 'dialog root stays mounted for focus restoration')
    const trigger = nodes(dialog).find(n => n.type === 'DialogTrigger')
    assert.ok(trigger, 'manage labels is registered as the dialog trigger')
    assert.equal(trigger.props.asChild, true)
    assert.equal(trigger.props.children.type, 'Button')
    assert.equal(text(trigger), '管理标签')
    return dialog
  }
  assert.equal(assertTrigger(panel).props.open, false)
  assert.equal(nodes(panel).some(n => n.type === 'DialogContent'), false)
  nodes(panel).find(n => n.props.type === 'search').props.onChange({ target: { value: 'Ship' } })
  button(h.renderTasks(), '管理标签')()
  panel = h.renderTasks()
  assert.equal(assertTrigger(panel).props.open, true)
  assert.equal(nodes(panel).find(n => n.type === 'DialogTitle').props.children, '管理标签')
  button(panel, '完成')()
  assert.equal(assertTrigger(h.renderTasks()).props.open, false)
  assert.equal(nodes(h.renderTasks()).some(n => n.type === 'DialogContent'), false)
  assertTrigger(h.renderTasks()).props.onOpenChange(true)
  assert.equal(assertTrigger(h.renderTasks()).props.open, true)
  assertTrigger(h.renderTasks()).props.onOpenChange(false)
  assert.equal(assertTrigger(h.renderTasks()).props.open, false)
  assert.equal(nodes(h.renderTasks()).find(n => n.props.type === 'search').props.value, 'Ship')
  assert.equal(h.calls.length, 0)
})

test('list status filter never silently hides board columns and empty searches explain results', () => {
  const h = tasksHarness([todoTask, { ...todoTask, id: '11', title: 'Finished', status: 'done' }])
  button(h.renderTasks(), '☰ 列表')()
  nodes(h.renderTasks()).find(n => n.props.role === 'tab' && text(n) === '已完成').props.onClick()
  assert.doesNotMatch(text(h.renderTasks()), /Ship feature/)
  button(h.renderTasks(), '▦ 看板')()
  assert.match(text(h.renderTasks()), /Ship feature/)
  assert.equal(nodes(h.renderTasks()).filter(n => n.props.role === 'tab').length, 0)
  nodes(h.renderTasks()).find(n => n.props.type === 'search').props.onChange({ target: { value: 'missing' } })
  assert.equal(nodes(h.renderTasks()).filter(n => n.props.className === 'tb-empty').length, 3)
  button(h.renderTasks(), '☰ 列表')()
  assert.equal(nodes(h.renderTasks()).find(n => n.type === 'EmptyState').props.title, '没有匹配的任务')
})

test('task create/edit use dialogs, delete requires confirmation, and failures keep the dialog open', async () => {
  const h = tasksHarness()
  button(h.renderTasks(), '＋新建任务')()
  let dialog = nodes(h.renderTasks()).find(n => n.type === 'DialogContent')
  assert.equal(text(nodes(dialog).find(n => n.type === 'DialogTitle')), '新建任务')
  assert.equal(nodes(dialog).find(n => n.props['aria-label'] === '备注').type, 'textarea')
  button(h.renderTasks(), '取消')()
  button(h.renderTasks(), '删除')()
  assert.equal(h.calls.length, 0)
  assert.equal(text(nodes(h.renderTasks()).find(n => n.type === 'DialogTitle')), '删除任务')
  button(h.renderTasks(), '取消')()
  assert.equal(h.calls.length, 0)
  button(h.renderTasks(), '删除')()
  h.rest = async () => { throw new Error('delete refused') }
  await button(h.renderTasks(), '确认删除')()
  assert.equal(text(nodes(h.renderTasks()).find(n => n.type === 'DialogTitle')), '删除任务')
  assert.equal(nodes(h.renderTasks()).find(n => n.type === 'DialogContent').props.banner, 'delete refused')
})

test('task details edit status and done tasks reopen without header navigation', async () => {
  const h = tasksHarness([{ ...todoTask, status: 'done' }])
  nodes(h.renderTasks()).find(n => n.props['aria-label'] === '查看任务 Ship feature').props.onClick({})
  assert.equal(text(nodes(h.renderTasks()).find(n => n.type === 'DialogTitle')), 'Ship feature')
  await nodes(h.renderTasks()).find(n => n.props['aria-label'] === '更新任务状态').props.onChange({ target: { value: 'todo' } })
  assert.deepEqual(plain(h.calls.at(-1)), ['rest', '/tasks/10', { method: 'PATCH', body: { status: 'todo' } }])
  button(h.renderTasks(), '关闭')()
  await button(h.renderTasks(), '↶ 重新打开')()
  assert.equal(h.calls.at(-1)[2].body.status, 'todo')
  assert.equal(nodes(h.renderTasks()).some(n => n.props['aria-label'] === '工作区视图'), false)
})

test('doing primary completes directly without launching a session', async () => {
  const h = tasksHarness([{ ...todoTask, status: 'doing' }])
  await button(h.renderTasks(), '✓ 标记完成')()
  assert.deepEqual(plain(h.calls), [['rest', '/tasks/10', { method: 'PATCH', body: { status: 'done' } }]])
})

test('non-todo tasks without sessions retain session launch in overflow', async () => {
  for (const status of ['doing', 'done']) {
    const h = tasksHarness([{ ...todoTask, status }])
    const more = nodes(h.renderTasks()).find(n => n.type === 'DropdownMenuContent')
    await button(more, '开始会话')()
    assert.equal(h.calls.find(c => c[0] === 'rpc')[1], 'session.create')
    assert.equal(h.calls.at(-1)[2].body.status, 'doing')
  }
})
