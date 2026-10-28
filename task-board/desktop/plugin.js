import { cn, host, useQuery, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA, Badge, Button, EmptyState, ScrollArea } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useRef, useState } from 'react'

const labelPalette = { red: '#f87171', orange: '#fb923c', amber: '#fbbf24', green: '#4ade80', teal: '#2dd4bf', blue: '#60a5fa', violet: '#a78bfa', gray: '#9ca3af' }
const labelChip = (name, color) => jsxs('span', { className: 'tb-label', style: { color: 'var(--ui-text-secondary)' }, children: [jsx('span', { className: 'tb-label-dot', 'aria-hidden': true, style: { backgroundColor: labelPalette[color] || labelPalette.gray } }), name] })

let taskFetch = null
let openExternal = null
const API_VERSION = 1 // Bump when backend routes change.
const staleMessage = '后端为旧版本：需重启/重载网关后生效'
const backendError = (data, error) => data && data.api_version !== API_VERSION || error && (error.status === 404 || error.statusCode === 404 || /^404\b/.test(error.message || '')) ? new Error(staleMessage) : error
const rest = async (path, options) => {
  try {
    const data = await taskFetch(path, options)
    const failure = backendError(path === '/tasks' && !options ? data : null)
    if (failure) throw failure
    return data
  } catch (error) {
    console.error('Task Board request failed:', path, error)
    throw backendError(null, error)
  }
}
const taskBoardStyles = `.tb-root { min-width:0; width:100%; max-width:100%; box-sizing:border-box; color:var(--ui-text-primary); font-size:12px; }
.tb-root *, .tb-root *::before, .tb-root *::after { box-sizing:border-box; }
.tb-root button, .tb-root input, .tb-root select { max-width:100%; font:inherit; }
.tb-root button { cursor:pointer; }
.tb-root button:focus-visible, .tb-root input:focus-visible, .tb-root select:focus-visible, .tb-root [tabindex]:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.tb-root button:disabled { cursor:default; opacity:.5; }
.tb-root .tb-tasks { padding:12px; display:flex; flex-direction:column; gap:8px; min-width:0; }
.tb-root .tb-task-columns { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
.tb-root .tb-task-zone { min-width:0; min-height:100px; padding:8px; border:1px solid var(--ui-stroke-secondary); border-radius:8px; }
.tb-root .tb-task-zone.tb-drop-target { border-color:var(--ui-accent); background:color-mix(in srgb, var(--ui-accent) 10%, transparent); }
.tb-root .tb-task-row[draggable="true"] { user-select:none; cursor:grab; }
.tb-root .tb-task-row.tb-dragging { opacity:0.45; }
@media (max-width:700px) { .tb-root .tb-task-columns { grid-template-columns:1fr; } }
.tb-root .tb-task-form { flex-wrap:wrap; }
.tb-root .tb-task-form input { flex:1 1 100%; }
.tb-root .tb-task-row { padding:8px 0; border-bottom:1px solid var(--ui-stroke-secondary); min-width:0; }
.tb-root .tb-task-row button { min-width:0; white-space:normal; overflow-wrap:anywhere; }
.tb-root .tb-task-id { display:inline-block; min-width:0; max-width:100%; overflow-wrap:anywhere; }
.tb-root .tb-task-title { flex:1 1 120px; min-width:0; overflow-wrap:anywhere; font-weight:600; }
.tb-root .tb-task-note { white-space:pre-wrap; overflow-wrap:anywhere; color:var(--ui-text-secondary); padding:4px 0; }
.tb-root .tb-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-width:0; }
.tb-root .tb-title { font-size:14px; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 100px; }
.tb-root select, .tb-root input { min-width:0; flex:1; height:32px; padding:5px 8px; border:1px solid var(--ui-stroke-secondary); border-radius:4px; color:var(--ui-text-primary); background:transparent; }
.tb-root .tb-section { margin:10px 4px 4px; padding:6px 0; border-bottom:1px solid var(--ui-stroke-secondary); color:var(--ui-text-secondary); font-size:12px; font-weight:600; }
.tb-root form { display:flex; gap:6px; align-items:center; min-width:0; }
.tb-root .tb-label { display:inline-flex; align-items:center; gap:4px; border-radius:10px; padding:2px 7px; max-width:100%; overflow-wrap:anywhere; }
.tb-root .tb-label-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.tb-root .tb-labels { display:flex; flex-wrap:wrap; gap:4px; width:100%; min-width:0; }
.tb-root .tb-label-choice { border:2px solid transparent; border-radius:12px; padding:1px; background:transparent; }
.tb-root .tb-label-choice[aria-pressed="true"] { border-color:var(--ui-text-primary); }
.tb-root .tb-label-manager summary { cursor:pointer; color:var(--ui-text-secondary); }
.tb-root .tb-label-manager { border:1px solid var(--ui-stroke-secondary); border-radius:8px; padding:12px; min-width:0; }
.tb-root .tb-label-manager form { flex-wrap:wrap; margin:6px 0; }
.tb-root .tb-label-manager input { flex:1 1 100px; }
.tb-root .tb-palette { display:flex; gap:4px; flex-wrap:wrap; }
.tb-root .tb-palette button { width:24px; height:24px; padding:2px; border:2px solid transparent; border-radius:50%; }
.tb-root .tb-palette button[aria-pressed="true"] { border-color:var(--ui-text-primary); }
.tb-root .tb-palette span { display:block; width:100%; height:100%; border-radius:50%; }
.tb-root .tb-tabs { display:flex; gap:2px; padding:3px; border:1px solid var(--ui-stroke-secondary); border-radius:8px; }
.tb-root .tb-tabs button { flex:1; min-width:0; padding:5px; border:0; border-radius:5px; background:transparent; color:var(--ui-text-secondary); }
.tb-root .tb-tabs button[aria-selected="true"] { background:var(--chrome-action-hover); color:var(--ui-text-primary); font-weight:600; }
.tb-root .tb-filters { display:flex; gap:8px; min-width:0; }
.tb-root .tb-filters input { flex:2; width:0; }
.tb-root .tb-filters select { flex:1; width:0; }
.tb-root .tb-primary { background:var(--ui-accent); color:var(--ui-text-primary); }
.tb-root .tb-refresh { width:32px; height:32px; padding:0; color:var(--ui-text-secondary); }
.tb-root .tb-empty { text-align:center; padding:20px 8px; color:var(--ui-text-secondary); }
.tb-root .tb-alert { padding:10px 12px; border:1px solid var(--ui-stroke-secondary); border-radius:8px; overflow-wrap:anywhere; }
`
const taskBoardStyle = () => jsx('style', { children: taskBoardStyles })

const taskStatus = { todo: '待办', doing: '进行中', done: '已完成' }
const launchedTasks = new Map()
const startingTasks = new Set()

function taskSessionTitle(task) {
  return task.ref ? task.ref + ' ' + task.title : task.title
}

const taskLaunchKey = task => JSON.stringify([host.state.profile.get(), task.id, task.created_at])

async function startTaskSession(task, update) {
  const key = taskLaunchKey(task)
  if (startingTasks.has(key)) return
  startingTasks.add(key)
  try {
    let link = launchedTasks.get(key) || task
    if (!link.session_id) {
      const profile = host.state.profile.get()
      const gateway = host.getGateway()
      if (!gateway) throw new Error('网关不可用')
      // The gateway's titled create persists the title and resolves an existing exact-title session.
      const title = taskSessionTitle(task)
      const created = await gateway.request('session.create', { title })
      if (!created?.stored_session_id) throw new Error('网关未返回会话 ID')
      link = { session_id: created.stored_session_id, session_profile: profile, session_title: title }
      launchedTasks.set(key, link)
    }
    await update({ session_id: link.session_id, session_profile: link.session_profile, session_title: link.session_title || '' })
    await host.openSession(link.session_id, { profile: link.session_profile })
    await update({ status: 'doing' })
  } finally { startingTasks.delete(key) }
}

function TasksPage() {
  const query = useQuery({ queryKey: ['task-board-tasks'], queryFn: () => rest('/tasks') })
  const labelsQuery = useQuery({ queryKey: ['task-board-labels'], queryFn: () => rest('/labels') })
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [labelEdits, setLabelEdits] = useState({})
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('blue')
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ title: '', ref: '', note: '', url: '', labels: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const draggedTask = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const run = async (action) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await action(); await query.refetch(); await labelsQuery.refetch() }
    catch (failure) { setError(failure.message || String(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const failures = [backendError(query.data, query.error), backendError(null, labelsQuery.error), error && new Error(error)].filter(Boolean)
  const failure = failures.find(item => item.message === staleMessage) || failures[0]
  const update = (task, body) => rest('/tasks/' + task.id, { method: 'PATCH', body })
  const edit = (task) => {
    setEditing(task?.id || 'new')
    setDraft({ title: task?.title || '', ref: task?.ref || '', note: task?.note || '', url: task?.url || '', labels: [...(task?.labels || [])] })
  }
  const definitions = labelsQuery.data?.labels || {}
  const palette = (value, onChange) => jsx('div', { className: 'tb-palette', role: 'group', 'aria-label': '标签颜色', children: Object.entries(labelPalette).map(([color, hex]) => jsx('button', {
    type: 'button', disabled: busy, 'aria-label': color, 'aria-pressed': value === color, onClick: () => onChange(color),
    children: jsx('span', { style: { backgroundColor: hex } })
  }, color)) })
  const changeDefinition = (name, replacement) => {
    setDraft(current => ({ ...current, labels: current.labels.flatMap(label => label === name ? (replacement ? [replacement] : []) : [label]) }))
    if (labelFilter === name) setLabelFilter(replacement || '')
    setLabelEdits(current => { const next = { ...current }; delete next[name]; return next })
  }
  const tasks = [...(query.data?.tasks || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order)
    .filter(t => (filter === 'all' || t.status === filter) && (!labelFilter || (t.labels || []).includes(labelFilter)) && [t.title, t.ref, t.note].join(' ').toLowerCase().includes(search.toLowerCase()))
  const action = (label, onClick, extra = {}) => jsx(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick, children: label, ...extra })
  return jsxs(ScrollArea, { className: 'tb-root h-full', children: [taskBoardStyle(),
    jsxs('div', { className: 'tb-tasks', children: [
      jsxs('div', { className: 'tb-toolbar', children: [jsx('span', { className: 'tb-title', children: '任务清单' }), action('新建任务', () => edit(null), { variant: 'default', className: 'tb-primary' }), action('↻', () => run(() => Promise.resolve()), { 'aria-label': '刷新', className: 'tb-refresh' })] }),
      jsxs('div', { className: 'tb-tabs', role: 'tablist', 'aria-label': '任务状态', children: Object.entries({ all: '全部', ...taskStatus }).map(([value, label]) => action(label, () => setFilter(value), { role: 'tab', 'aria-selected': filter === value })) }),
      jsxs('div', { className: 'tb-filters', children: [jsx('input', { type: 'search', value: search, placeholder: '搜索任务', 'aria-label': '搜索任务', onChange: e => setSearch(e.target.value) }),
      jsx('select', { value: labelFilter, 'aria-label': '标签筛选', onChange: e => setLabelFilter(e.target.value), children: [
        jsx('option', { value: '', children: '全部标签' }), ...Object.keys(definitions).map(name => jsx('option', { value: name, children: name }, name))
      ] })] }),
      jsxs('details', { className: 'tb-label-manager', children: [jsx('summary', { children: '管理标签' }),
        ...Object.entries(definitions).map(([name, color]) => {
          const value = Object.hasOwn(labelEdits, name) ? labelEdits[name] : { name, color }
          const editLabel = patch => setLabelEdits({ ...labelEdits, [name]: { ...value, ...patch } })
          return jsxs('form', { 'aria-label': '管理标签 ' + name, onSubmit: e => { e.preventDefault(); return run(async () => {
            await rest('/labels', { method: 'PATCH', body: { name, new_name: value.name, color: value.color } })
            changeDefinition(name, value.name.trim())
          }) }, children: [labelChip(name, color),
            jsx('input', { 'aria-label': '重命名 ' + name, required: true, maxLength: 40, value: value.name, onChange: e => editLabel({ name: e.target.value }) }),
            palette(value.color, color => editLabel({ color })),
            jsx(Button, { type: 'submit', size: 'sm', disabled: busy, children: '保存标签' }),
            action('删除标签', () => run(async () => { await rest('/labels?name=' + encodeURIComponent(name), { method: 'DELETE' }); changeDefinition(name, null) }), { type: 'button', 'aria-label': '删除标签 ' + name })
          ] }, name)
        }),
        jsxs('form', { 'aria-label': '新建标签', onSubmit: e => { e.preventDefault(); return run(async () => {
          await rest('/labels', { method: 'POST', body: { name: newLabel, color: newColor } }); setNewLabel('')
        }) }, children: [jsx('input', { 'aria-label': '新标签名称', value: newLabel, required: true, maxLength: 40, onChange: e => setNewLabel(e.target.value) }),
          palette(newColor, setNewColor), jsx(Button, { type: 'submit', size: 'sm', disabled: busy, children: '添加标签' })] })
      ] }),
      error || failure || query.isError || labelsQuery.isError ? jsx('div', { className: 'tb-alert', role: 'alert', children: failure?.message || error || '加载失败' }) : null,
      editing ? jsxs('form', { className: 'tb-task-form', onSubmit: e => { e.preventDefault(); return run(async () => {
        await rest(editing === 'new' ? '/tasks' : '/tasks/' + editing, { method: editing === 'new' ? 'POST' : 'PATCH', body: draft }); setEditing(null)
      }) }, children: [
        ...[['title', '标题'], ['ref', '任务编号(ref)'], ['note', '备注'], ['url', '链接(url)']].map(([key, label]) => jsx('input', {
          'aria-label': label, placeholder: label, required: key === 'title', type: key === 'url' ? 'url' : 'text', value: draft[key], onChange: e => setDraft({ ...draft, [key]: e.target.value }) }, key)),
        jsx('div', { className: 'tb-labels', role: 'group', 'aria-label': '任务标签', children: Object.entries(definitions).map(([name, color]) => jsx('button', {
          type: 'button', className: 'tb-label-choice', disabled: busy, 'aria-pressed': draft.labels.includes(name), onClick: () => setDraft({ ...draft, labels: draft.labels.includes(name) ? draft.labels.filter(label => label !== name) : [...draft.labels, name] }), children: labelChip(name, color)
        }, name)) }),
        jsx(Button, { type: 'submit', size: 'sm', disabled: busy, children: '保存' }), action('取消', () => setEditing(null), { type: 'button' })
      ] }) : null,
      query.isLoading ? jsx('div', { children: '加载任务…' }) : !tasks.length ? jsx(EmptyState, { title: '暂无任务' }) : null,
      tasks.length ? jsx('div', { className: 'tb-task-columns', children: Object.entries(taskStatus).map(([status, label]) => jsxs('section', {
        className: cn('tb-task-zone', dropTarget === status && 'tb-drop-target'), 'aria-label': label,
        onDragOver: e => {
          if (!draggedTask.current || draggedTask.current.status === status || busyRef.current) return
          e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget(status)
        },
        onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null) },
        onDrop: e => {
          e.preventDefault()
          const task = draggedTask.current
          draggedTask.current = null; setDragging(null); setDropTarget(null)
          if (task && task.status !== status) return run(() => update(task, { status }))
        },
        children: [jsx('div', { className: 'tb-section', children: label }),
          !tasks.some(t => t.status === status) ? jsx('div', { className: 'tb-empty', children: '暂无任务' }) : null,
      ...[true, false].map(pinned => jsxs('div', { children: [
        tasks.some(t => t.status === status && t.pinned === pinned) ? jsx('div', { className: 'tb-section', children: pinned ? '置顶' : '任务' }) : null,
        ...tasks.filter(t => t.status === status && t.pinned === pinned).map(task => jsxs('div', {
          className: cn('tb-task-row', dragging === task.id && 'tb-dragging'), draggable: !busy,
          onDragStart: e => {
            if (busyRef.current) { e.preventDefault(); return }
            draggedTask.current = task; setDragging(task.id)
            e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id)
          },
          onDragEnd: () => { draggedTask.current = null; setDragging(null); setDropTarget(null) },
          children: [
          jsxs('div', { className: 'tb-toolbar', children: [
            action(taskStatus[task.status], () => run(() => update(task, { status: { todo: 'doing', doing: 'done', done: 'todo' }[task.status] })), { 'aria-label': '切换状态 ' + task.title }),
            jsx('span', { className: 'tb-task-title', children: task.title }),
            task.ref || task.url ? (task.url ? action(task.ref || '链接', () => run(async () => {
              if (!await openExternal(task.url)) throw new Error('系统未打开链接')
            })) : jsx(Badge, { className: 'tb-task-id', children: task.ref })) : null
          ] }),
          jsx('div', { className: 'tb-labels', children: (task.labels || []).map(name => jsx('span', { children: labelChip(name, definitions[name]) }, name)) }),
          task.note ? jsx('div', { className: 'tb-task-note', children: task.note }) : null,
          jsxs('div', { className: 'tb-toolbar', children: [
            action(task.session_id || launchedTasks.has(taskLaunchKey(task)) ? '打开会话' : '开始会话', () => run(() => startTaskSession(task, body => update(task, body)))),
            action('编辑', () => edit(task)), action('删除', () => run(() => rest('/tasks/' + task.id, { method: 'DELETE' }))),
            action(task.pinned ? '取消置顶' : '置顶', () => run(() => update(task, { pinned: !task.pinned }))),
            ...[['↑', 'up'], ['↓', 'down']].map(([label, direction]) => action(label, () => run(() => rest('/tasks/' + task.id + '/reorder', { method: 'POST', body: { direction } })), { 'aria-label': (direction === 'up' ? '上移 ' : '下移 ') + task.title }))
          ] })
        ] }, task.id))
      ] }, String(pinned)))
        ]
      }, status)) }) : null
    ] })
  ] })
}

export default {
  id: 'task-board',
  name: 'Task Board',
  description: 'Independent task list with titled chat sessions.',
  register(ctx) {
    ctx.onDispose(() => { launchedTasks.clear() })
    taskFetch = (path, options) => ctx.rest(path, options)
    openExternal = (url) => ctx.os.openExternal(url)
    ctx.register({ id: 'tasks-page', area: ROUTES_AREA, data: { path: '/tasks' }, render: () => jsx(TasksPage, {}) })
    ctx.register({ id: 'tasks-nav', area: SIDEBAR_NAV_AREA, data: { path: '/tasks', label: 'Task Board', codicon: 'checklist' } })
    ctx.register({ id: 'tasks-open', area: PALETTE_AREA, data: { id: 'task-board-open', label: 'Task Board：打开任务清单', run: () => host.navigate('/tasks') } })
  }
}
