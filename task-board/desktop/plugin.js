import { cn, host, useQuery, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA, Badge, Button, EmptyState, ScrollArea } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useRef, useState } from 'react'

let taskFetch = null
let openExternal = null
const rest = (path, options) => taskFetch(path, options)
const taskBoardStyles = `.tb-root { min-width:0; width:100%; max-width:100%; box-sizing:border-box; color:var(--ui-text-primary); font-size:12px; }
.tb-root *, .tb-root *::before, .tb-root *::after { box-sizing:border-box; }
.tb-root button, .tb-root input { max-width:100%; font:inherit; }
.tb-root button { cursor:pointer; }
.tb-root button:focus-visible, .tb-root input:focus-visible, .tb-root [tabindex]:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
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
.tb-root .tb-title { font-size:14px; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 100%; }
.tb-root input { min-width:0; flex:1; padding:5px 6px; border:1px solid var(--ui-stroke-secondary); border-radius:4px; color:var(--ui-text-primary); background:transparent; }
.tb-root .tb-section { margin:10px 4px 4px; padding:6px 0; border-bottom:1px solid var(--ui-stroke-secondary); color:var(--ui-text-secondary); font-size:12px; font-weight:600; }
.tb-root form { display:flex; gap:6px; align-items:center; min-width:0; }
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
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ title: '', ref: '', note: '', url: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const draggedTask = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const run = async (action) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await action(); await query.refetch() }
    catch (failure) { setError(failure.message || String(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const update = (task, body) => rest('/tasks/' + task.id, { method: 'PATCH', body })
  const edit = (task) => {
    setEditing(task?.id || 'new')
    setDraft({ title: task?.title || '', ref: task?.ref || '', note: task?.note || '', url: task?.url || '' })
  }
  const tasks = [...(query.data?.tasks || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order)
    .filter(t => (filter === 'all' || t.status === filter) && [t.title, t.ref, t.note].join(' ').toLowerCase().includes(search.toLowerCase()))
  const action = (label, onClick, extra = {}) => jsx(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick, children: label, ...extra })
  return jsxs(ScrollArea, { className: 'tb-root h-full', children: [taskBoardStyle(),
    jsxs('div', { className: 'tb-tasks', children: [
      jsxs('div', { className: 'tb-toolbar', children: [jsx('span', { className: 'tb-title', children: '任务清单' }), action('新建任务', () => edit(null)), action('刷新', () => run(() => Promise.resolve()))] }),
      jsxs('div', { className: 'tb-toolbar', role: 'tablist', 'aria-label': '任务状态', children: Object.entries({ all: '全部', ...taskStatus }).map(([value, label]) => action(label, () => setFilter(value), { role: 'tab', 'aria-selected': filter === value })) }),
      jsx('input', { type: 'search', value: search, placeholder: '搜索任务', 'aria-label': '搜索任务', onChange: e => setSearch(e.target.value) }),
      error || query.isError ? jsx('div', { role: 'alert', children: error || query.error?.message || '加载失败' }) : null,
      editing ? jsxs('form', { className: 'tb-task-form', onSubmit: e => { e.preventDefault(); return run(async () => {
        await rest(editing === 'new' ? '/tasks' : '/tasks/' + editing, { method: editing === 'new' ? 'POST' : 'PATCH', body: draft }); setEditing(null)
      }) }, children: [
        ...[['title', '标题'], ['ref', '任务编号(ref)'], ['note', '备注'], ['url', '链接(url)']].map(([key, label]) => jsx('input', {
          'aria-label': label, placeholder: label, required: key === 'title', type: key === 'url' ? 'url' : 'text', value: draft[key], onChange: e => setDraft({ ...draft, [key]: e.target.value }) }, key)),
        jsx(Button, { type: 'submit', size: 'sm', disabled: busy, children: '保存' }), action('取消', () => setEditing(null), { type: 'button' })
      ] }) : null,
      query.isLoading ? jsx('div', { children: '加载任务…' }) : !tasks.length ? jsx(EmptyState, { title: '暂无任务' }) : null,
      jsx('div', { className: 'tb-task-columns', children: Object.entries(taskStatus).map(([status, label]) => jsxs('section', {
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
      }, status)) })
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
