import { cn, host, useQuery, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA, Badge, Button, Codicon, EmptyState, ScrollArea, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

const labelPalette = { red: 'var(--ui-red)', orange: 'var(--ui-orange)', amber: 'var(--ui-yellow)', green: 'var(--ui-green)', teal: 'var(--ui-cyan)', blue: 'var(--ui-blue)', violet: 'var(--ui-purple)', gray: 'var(--ui-text-tertiary)' }
const labelChip = (name, color) => jsxs('span', { className: 'tb-label', style: { color: 'var(--ui-text-secondary)' }, children: [jsx('span', { className: 'tb-label-dot', 'aria-hidden': true, style: { backgroundColor: labelPalette[color] || labelPalette.gray } }), name] })

let taskStorage = null
let taskFetch = null
let openExternal = null
const API_VERSION = 3 // Bump when the API contract changes.
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
const taskBoardStyles = `.tb-root { --tb-space:calc(.25rem * var(--spacing-mul, 1)); --tb-surface:var(--ui-bg-quaternary); min-width:0; width:100%; max-width:100%; color:var(--ui-text-primary); font-size:12px; line-height:1.6; container-type:inline-size; }
.tb-root, .tb-root *, .tb-root *::before, .tb-root *::after { box-sizing:border-box; }
.tb-root button, .tb-root input, .tb-root select { max-width:100%; font:inherit; }
.tb-root button { cursor:pointer; }
.tb-root button:disabled { cursor:default; opacity:.5; }
.tb-root button:focus-visible, .tb-root input:focus-visible, .tb-root select:focus-visible, .tb-root summary:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.tb-root .tb-tasks { display:flex; flex-direction:column; gap:calc(var(--tb-space) * 5); min-width:0; padding:calc(var(--tb-space) * 7); }
.tb-root .tb-page-header { padding-bottom:calc(var(--tb-space) * 5); border-bottom:1px solid var(--ui-stroke-secondary); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:calc(var(--tb-space) * 4); }
.tb-root .tb-eyebrow { color:var(--ui-accent); font-size:10px; letter-spacing:.16em; }
.tb-root h1 { font-size:24px; font-weight:650; line-height:1.3; margin:calc(var(--tb-space) * 2) 0; }
.tb-root p { margin:0; color:var(--ui-text-secondary); }
.tb-root .tb-primary { padding:calc(var(--tb-space) * 2) calc(var(--tb-space) * 4); }
.tb-root .tb-filters { display:flex; align-items:center; flex-wrap:wrap; gap:calc(var(--tb-space) * 3); min-width:0; padding-bottom:calc(var(--tb-space) * 5); border-bottom:1px solid var(--ui-stroke-secondary); }
.tb-root input, .tb-root select { min-width:0; height:36px; padding:calc(var(--tb-space) * 2) calc(var(--tb-space) * 3); border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-sm); color:var(--ui-text-primary); background:var(--ui-bg-editor); }
.tb-root input::placeholder { color:var(--ui-text-tertiary); }
.tb-root .tb-search { display:flex; align-items:center; flex:1 1 220px; min-width:0; gap:var(--tb-space); padding-left:calc(var(--tb-space) * 3); background:var(--ui-bg-editor); border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-sm); color:var(--ui-text-tertiary); }
.tb-root .tb-search:focus-within { outline:2px solid var(--ui-accent); outline-offset:2px; }
.tb-root .tb-search input { border:0; width:100%; background:transparent; outline:none; }
.tb-root .tb-filters { --tb-control-height:calc(var(--tb-space) * 9); }
.tb-root .tb-filters > button, .tb-root .tb-filters > select, .tb-root .tb-search, .tb-root .tb-view-toggle { height:var(--tb-control-height); border-radius:var(--radius-sm); }
.tb-root .tb-filters > button, .tb-root .tb-filters > select { padding-block:0; line-height:16px; }
.tb-root .tb-search input { height:100%; padding-block:0; line-height:16px; }
.tb-root .tb-filters select { flex:0 1 auto; max-width:180px; }
.tb-root .tb-view-toggle { display:flex; align-items:stretch; flex-shrink:0; border-radius:var(--radius-sm); padding:calc(var(--tb-space) * .75); background:var(--tb-surface); }
.tb-root .tb-view-toggle button { height:100%; padding-block:0; line-height:16px; white-space:nowrap; }
.tb-root .tb-view-toggle [aria-checked="true"] { background:var(--chrome-action-hover); color:var(--ui-text-primary); }
.tb-root .tb-refresh { width:var(--tb-control-height); height:var(--tb-control-height); padding:0; color:var(--ui-text-secondary); }
.tb-root .tb-tabs { display:flex; gap:var(--tb-space); }
.tb-root .tb-tabs [aria-selected="true"] { background:var(--chrome-action-hover); color:var(--ui-text-primary); }
.tb-root .tb-task-columns { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr)); align-items:stretch; gap:calc(var(--tb-space) * 5); }
.tb-root .tb-task-zone { display:flex; flex-direction:column; min-width:0; min-height:420px; padding:calc(var(--tb-space) * 3); border:1px solid transparent; border-radius:var(--radius-lg); background:var(--tb-surface); }
.tb-root .tb-task-zone.tb-drop-target { border-color:var(--ui-accent); background:color-mix(in srgb, var(--ui-accent) 10%, var(--tb-surface)); }
.tb-root .tb-column-head, .tb-root .tb-card-top, .tb-root .tb-card-foot { display:flex; align-items:center; gap:calc(var(--tb-space) * 2); min-width:0; }
.tb-root .tb-column-head { margin-bottom:calc(var(--tb-space) * 3); padding:var(--tb-space); }
.tb-root .tb-column-head > button { margin-left:auto; }
.tb-root .tb-count { color:var(--ui-text-secondary); background:var(--chrome-action-hover); padding:0 calc(var(--tb-space) * 1.5); border-radius:var(--radius-sm); font-size:11px; }
.tb-root .tb-task-row { position:relative; min-width:0; padding:calc(var(--tb-space) * 4); margin-bottom:calc(var(--tb-space) * 3); border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-md); background:var(--ui-bg-editor); }
.tb-root .tb-task-row:hover { border-color:var(--ui-stroke-primary); }
.tb-root .tb-task-row[draggable="true"] { cursor:grab; }
.tb-root .tb-task-row.tb-dragging { opacity:.45; }
.tb-root .tb-task-row.tb-insert-before { box-shadow:0 -3px 0 var(--ui-accent); }
.tb-root .tb-task-row.tb-insert-after { box-shadow:0 3px 0 var(--ui-accent); }
.tb-root .tb-task-row button { min-width:0; }
.tb-root .tb-card-top > :not(.tb-task-title) { flex-shrink:0; }
.tb-root .tb-task-title { flex:1; min-width:0; overflow-wrap:anywhere; font-weight:600; font-size:14px; padding:0; border:0; background:transparent; color:var(--ui-text-primary); text-align:left; }
.tb-root .tb-task-title:hover { color:var(--ui-accent); }
.tb-root .tb-task-note { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--ui-text-secondary); margin:calc(var(--tb-space) * 3) 0; }
.tb-root .tb-labels { display:flex; flex-wrap:wrap; gap:var(--tb-space); min-width:0; }
.tb-root .tb-task-row .tb-labels:empty { display:none; }
.tb-root .tb-task-id, .tb-root .tb-label { display:inline-flex; align-items:center; gap:var(--tb-space); min-width:0; max-width:100%; padding:0 calc(var(--tb-space) * 1.5); border-radius:var(--radius-sm); background:var(--tb-surface); font-size:11px; overflow-wrap:anywhere; }
.tb-root .tb-task-id { font-family:monospace; }
.tb-root .tb-label-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.tb-root .tb-card-foot { flex-wrap:wrap; margin-top:calc(var(--tb-space) * 3); padding-top:calc(var(--tb-space) * 2); border-top:1px solid var(--ui-stroke-secondary); }
.tb-root .tb-card-foot > button { padding-left:0; color:var(--ui-accent); }
.tb-root time { margin-left:auto; color:var(--ui-text-tertiary); font-size:11px; }
.tb-root .tb-more, .tb-root .tb-source { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; padding:0; color:var(--ui-text-tertiary); }
.tb-root .tb-pinned { display:inline-flex; align-items:center; margin-right:var(--tb-space); color:var(--ui-accent); vertical-align:middle; }
.tb-root.tb-menu { min-width:160px; width:auto; background:var(--ui-bg-elevated); color:var(--ui-text-primary); }
.tb-root.tb-menu button { justify-content:flex-start; width:100%; white-space:nowrap; }
.tb-root .tb-add-task { width:100%; border:1px dashed var(--ui-stroke-secondary); color:var(--ui-text-secondary); margin-top:auto; }
.tb-root .tb-empty { display:flex; flex:1; flex-direction:column; align-items:center; justify-content:center; gap:calc(var(--tb-space) * 2); text-align:center; padding:calc(var(--tb-space) * 6) calc(var(--tb-space) * 2); color:var(--ui-text-secondary); }
.tb-root .tb-empty-icon { display:grid; place-items:center; width:40px; height:40px; margin-bottom:calc(var(--tb-space) * 2); border:1px dashed var(--ui-stroke-secondary); border-radius:var(--radius-md); color:var(--ui-accent); font-size:22px; }
.tb-root .tb-empty p { font-size:11px; }
.tb-root .tb-task-list .tb-task-row { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr) 4em minmax(220px,1fr) auto auto; grid-template-areas:"title labels status actions menu source"; align-items:center; gap:calc(var(--tb-space) * 3); }
.tb-root .tb-task-list .tb-card-top { display:contents; }
.tb-root .tb-task-list .tb-task-title { grid-area:title; }
.tb-root .tb-task-list .tb-more { grid-area:menu; }
.tb-root .tb-task-list .tb-source { grid-area:source; }
.tb-root .tb-task-list .tb-labels { grid-area:labels; }
.tb-root .tb-task-list .tb-list-status { grid-area:status; }
.tb-root .tb-task-list .tb-task-note { display:none; }
.tb-root .tb-task-list .tb-card-foot { grid-area:actions; min-width:0; margin:0; padding:0; border:0; }
.tb-root .tb-list-status { color:var(--ui-text-secondary); }
.tb-root .tb-alert { padding:calc(var(--tb-space) * 3); border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-sm); overflow-wrap:anywhere; }
.tb-root form { display:flex; gap:calc(var(--tb-space) * 2); align-items:center; flex-wrap:wrap; min-width:0; }
.tb-root form input { flex:1 1 100px; }
.tb-root .tb-task-form { gap:calc(var(--tb-space) * 4); }
.tb-root .tb-task-form .tb-labels { flex-basis:100%; }
.tb-root .tb-field { display:flex; flex-direction:column; gap:calc(var(--tb-space) * 1.5); width:100%; color:var(--ui-text-secondary); }
.tb-root .tb-field input, .tb-root .tb-field textarea { width:100%; flex:none; }
.tb-root textarea { font:inherit; padding:calc(var(--tb-space) * 3); border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-sm); background:var(--ui-bg-editor); color:var(--ui-text-primary); resize:vertical; min-height:88px; }
.tb-root textarea:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.tb-root .tb-detail-note { white-space:pre-wrap; overflow-wrap:anywhere; }
.tb-root .tb-form-actions { width:100%; }
.tb-root .tb-dialog-actions { display:flex; gap:calc(var(--tb-space) * 2); justify-content:flex-end; }
.tb-root .tb-stats { display:flex; flex-wrap:wrap; gap:calc(var(--tb-space) * 5); font-size:11px; color:var(--ui-text-secondary); }

.tb-root.tb-dialog { width:calc(100vw - 32px); max-width:560px; }
.tb-root .tb-label-manager { display:flex; flex-direction:column; gap:calc(var(--tb-space) * 4); }
.tb-root .tb-label-manager form + form { padding-top:calc(var(--tb-space) * 4); border-top:1px solid var(--ui-stroke-secondary); }
.tb-root .tb-label-manager form > .tb-label { flex-basis:100%; background:transparent; padding:0; }
.tb-root .tb-label-choice { border:2px solid transparent; border-radius:var(--radius-sm); padding:var(--tb-space); background:transparent; }
.tb-root .tb-label-choice[aria-pressed="true"] { border-color:var(--ui-accent); }
.tb-root .tb-palette { display:flex; gap:var(--tb-space); flex-wrap:wrap; }
.tb-root .tb-palette button { width:24px; height:24px; padding:calc(var(--tb-space) * .5); border:2px solid transparent; border-radius:50%; background:transparent; }
.tb-root .tb-palette button[aria-pressed="true"] { border-color:var(--ui-text-primary); }
.tb-root .tb-palette span { display:block; width:100%; height:100%; border-radius:50%; }
@container (max-width:760px) {
  .tb-root .tb-tasks { padding:calc(var(--tb-space) * 4); gap:calc(var(--tb-space) * 4); }
  .tb-root .tb-task-columns { grid-template-columns:1fr; }
  .tb-root .tb-task-zone { min-height:220px; }
  .tb-root .tb-task-list .tb-task-row { grid-template-columns:minmax(0,1fr) auto auto; grid-template-areas:"title menu source" "labels labels labels" "status status status" "actions actions actions"; }
}
`
const taskBoardStyle = () => jsx('style', { children: taskBoardStyles })

const defaultStatuses = [{ id: 'todo', name: '待办', color: 'gray', category: 'todo' }, { id: 'doing', name: '进行中', color: 'blue', category: 'doing' }, { id: 'done', name: '已完成', color: 'green', category: 'done' }]
const launchedTasks = new Map()
const startingTasks = new Set()

function taskSessionTitle(task) {
  return task.ref ? task.ref + ' ' + task.title : task.title
}

const taskLaunchKey = task => JSON.stringify([host.state.profile.get(), task.id, task.created_at])

async function startTaskSession(task, update, doingStatus = 'doing') {
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
    await update({ status: doingStatus })
  } finally { startingTasks.delete(key) }
}

function relativeTime(value) {
  if (!value) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (!Number.isFinite(minutes)) return ''
  return minutes < 1 ? '刚刚' : minutes < 60 ? minutes + ' 分钟前' : minutes < 1440 ? Math.floor(minutes / 60) + ' 小时前' : Math.floor(minutes / 1440) + ' 天前'
}

function TasksPage() {
  const query = useQuery({ queryKey: ['task-board-tasks'], queryFn: () => rest('/tasks') })
  const labelsQuery = useQuery({ queryKey: ['task-board-labels'], queryFn: () => rest('/labels') })
  const statuses = query.data?.statuses || defaultStatuses
  const taskStatus = Object.fromEntries(statuses.map(s => [s.id, s.name]))
  const category = id => statuses.find(s => s.id === id)?.category
  const first = cat => statuses.find(s => s.category === cat)?.id
  const nextStatus = task => {
    if (category(task.status) === 'todo') return first('doing')
    if (category(task.status) === 'done') return first('todo')
    return statuses.slice(statuses.findIndex(s => s.id === task.status) + 1).find(s => s.category === 'doing' || s.category === 'done')?.id || first('done')
  }
  const [statusesOpen, setStatusesOpen] = useState(false)
  const [statusDraft, setStatusDraft] = useState([])
  const [migrations, setMigrations] = useState({})
  const [syncActive, setSyncActive] = useState(false)
  const syncQuery = useQuery({ queryKey: ['task-board-sync'], queryFn: async () => {
    const state = await rest('/sync')
    setSyncActive(!!state.running)
    return state
  }, refetchInterval: q => syncActive || (q.state?.data || q.data)?.running ? 1000 : false })
  const syncRunning = syncActive || !!syncQuery.data?.running
  const wasSyncing = useRef(false)
  useEffect(() => {
    if (wasSyncing.current && !syncRunning && !syncQuery.error && syncQuery.data) { query.refetch(); labelsQuery.refetch() }
    wasSyncing.current = syncRunning
  }, [syncRunning, syncQuery.error, syncQuery.data])
  const [view, setView] = useState(() => taskStorage.get('view', 'board') === 'list' ? 'list' : 'board')
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [labelEdits, setLabelEdits] = useState({})
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('blue')
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const dialogOrigin = useRef(null)
  const menuDialog = useRef(false)
  const [draft, setDraft] = useState({ title: '', ref: '', note: '', url: '', labels: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const draggedTask = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [insertion, setInsertion] = useState(null)
  const placementAt = e => e.clientY < e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2 ? 'before' : 'after'
  const run = async (action) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await action(); await query.refetch(); await labelsQuery.refetch() }
    catch (failure) { setError(failure.message || String(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const failures = [backendError(query.data, query.error), backendError(null, labelsQuery.error), error && new Error(error)].filter(Boolean)
  const failure = failures.find(item => item.message === staleMessage) || failures[0]
  const canRenderTasks = !query.isLoading && query.data?.api_version === API_VERSION
  const update = (task, body) => rest('/tasks/' + task.id, { method: 'PATCH', body })
  const rememberFocus = event => { if (event?.currentTarget && !event.currentTarget.closest?.('[role=menu]')) dialogOrigin.current = event.currentTarget.closest?.('.tb-task-row')?.querySelector('.tb-task-title') || event.currentTarget }
  const restoreFocus = event => { if (dialogOrigin.current?.isConnected) { event.preventDefault(); dialogOrigin.current.focus() } }
  const edit = (task, status, event) => {
    rememberFocus(event)
    menuDialog.current = true
    setEditing(task?.id || 'new')
    setDraft({ title: task?.title || '', ref: task?.ref || '', note: task?.note || '', url: task?.url || '', labels: [...(task?.labels || [])], ...(status ? { status } : {}) })
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
  const allTasks = query.data?.tasks || []
  const selected = allTasks.find(task => task.id === selectedId)
  const tasks = [...allTasks].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order)
    .filter(t => (view === 'board' || filter === '' || t.status === filter) && (!labelFilter || (t.labels || []).includes(labelFilter)) && [t.title, t.ref, t.note].join(' ').toLowerCase().includes(search.toLowerCase()))
  const action = (label, onClick, extra = {}) => jsx(Button, { 'aria-label': label, variant: 'ghost', size: 'sm', disabled: busy, onClick, children: label, ...extra })
  const sourceAction = task => task.url ? action('打开原地址', event => {
    event.stopPropagation()
    return run(async () => { if (!await openExternal(task.url)) throw new Error('系统未打开链接') })
  }, { className: 'tb-source', title: '打开原地址：' + task.url, children: jsx(Codicon, { name: 'link-external', size: 14, 'aria-hidden': true }) }) : null
  const menuAction = (label, onClick, extra = {}) => jsx(DropdownMenuItem, { asChild: true, disabled: busy, children: action(label, onClick, extra) })
  const renderTask = task => jsxs('div', {
          className: cn('tb-task-row', dragging === task.id && 'tb-dragging', insertion?.id === task.id && 'tb-insert-' + insertion.placement), draggable: !busy,
          onDragStart: e => {
            if (busyRef.current) { e.preventDefault(); return }
            draggedTask.current = task; setDragging(task.id)
            e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id)
          },
          onDragEnd: () => { draggedTask.current = null; setDragging(null); setDropTarget(null); setInsertion(null) },
          onDragOver: e => {
            const source = draggedTask.current
            if (!source || busyRef.current || source.status !== task.status) return
            e.stopPropagation(); setDropTarget(null)
            if (source.id === task.id || source.pinned !== task.pinned) { setInsertion(null); return }
            e.preventDefault(); e.dataTransfer.dropEffect = 'move'
            setInsertion({ id: task.id, placement: placementAt(e) })
          },
          onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setInsertion(null) },
          onDrop: e => {
            const source = draggedTask.current
            if (!source || source.status !== task.status) return
            e.preventDefault(); e.stopPropagation()
            draggedTask.current = null; setDragging(null); setDropTarget(null); setInsertion(null)
            if (busyRef.current || source.id === task.id || source.pinned !== task.pinned) return
            return run(() => rest('/tasks/' + source.id + '/reorder', { method: 'POST', body: { target_id: task.id, placement: placementAt(e) } }))
          },
          children: [
          jsxs('div', { className: 'tb-card-top', children: [jsx('button', { type: 'button', className: 'tb-task-title', 'aria-label': '查看任务 ' + task.title, onClick: event => { rememberFocus(event); setSelectedId(task.id) }, children: [task.pinned ? jsx('span', { className: 'tb-pinned', role: 'img', title: '置顶', 'aria-label': '置顶', children: jsx(Codicon, { name: 'pinned', size: 14, 'aria-hidden': true }) }) : null, task.title] }),
            jsxs(DropdownMenu, { onOpenChange: open => { if (open) menuDialog.current = false }, children: [jsx(DropdownMenuTrigger, { asChild: true, children: action('任务操作', event => { menuDialog.current = false; rememberFocus(event) }, { 'aria-label': '任务操作 ' + task.title, className: 'tb-more', children: jsx(Codicon, { name: 'ellipsis', size: 14, 'aria-hidden': true }), onPointerDown: rememberFocus, onKeyDown: rememberFocus }) }), jsxs(DropdownMenuContent, { className: 'tb-root tb-menu', align: 'end', onCloseAutoFocus: event => { if (menuDialog.current) { event.preventDefault(); menuDialog.current = false } }, children: [
            category(task.status) !== 'todo' && !task.session_id && !launchedTasks.has(taskLaunchKey(task)) ? menuAction('开始会话', () => run(() => startTaskSession(task, body => update(task, body), first('doing')))) : null,
            menuAction('编辑', () => edit(task)), menuAction('删除', () => { menuDialog.current = true; setDeleting(task) }),
            menuAction(task.pinned ? '取消置顶' : '置顶', () => run(() => update(task, { pinned: !task.pinned }))),
            menuAction(taskStatus[task.status], () => run(() => update(task, { status: nextStatus(task) })), { 'aria-label': '切换状态 ' + task.title }),
          ] })] }), sourceAction(task)] }),
          task.note ? jsx('div', { className: 'tb-task-note', children: task.note }) : null,
          jsxs('div', { className: 'tb-labels', children: [
            task.ref ? jsx(Badge, { className: 'tb-task-id', children: task.ref }) : null,
            ...(task.labels || []).map(name => jsx('span', { children: labelChip(name, definitions[name]) }, name))
          ] }),
          view === 'list' ? jsx('span', { className: 'tb-list-status', children: taskStatus[task.status] }) : null,
          jsxs('div', { className: 'tb-card-foot', children: [
            category(task.status) === 'todo' ? !task.session_id ? action('▷ 开始任务', () => run(() => startTaskSession(task, body => update(task, body), first('doing')))) : null : category(task.status) === 'doing' ? action(nextStatus(task) === first('done') ? '✓ 标记完成' : '→ ' + taskStatus[nextStatus(task)], () => run(() => update(task, { status: nextStatus(task) }))) : action('↶ 重新打开', () => run(() => update(task, { status: first('todo') }))),
            (task.session_id || category(task.status) !== 'todo' && launchedTasks.has(taskLaunchKey(task))) ? action('打开会话', () => run(async () => { const link = launchedTasks.get(taskLaunchKey(task)) || task; await host.openSession(link.session_id, { profile: link.session_profile }) })) : null,
            jsx('time', { dateTime: task.updated_at || task.created_at, children: relativeTime(task.updated_at || task.created_at) })
          ] })
        ] }, task.id)
  return jsxs(ScrollArea, { className: 'tb-root h-full', children: [taskBoardStyle(),
    jsxs('div', { className: 'tb-tasks', children: [
      jsxs('header', { className: 'tb-page-header', children: [jsxs('div', { children: [jsx('div', { className: 'tb-eyebrow', children: 'WORKSPACE / TASK BOARD' }), jsx('h1', { children: '任务清单' }), jsx('p', { children: '整理待办事项，专注推进每一项任务。' })] }), action('＋新建任务', event => edit(null, undefined, event), { variant: 'default', className: 'tb-primary' })] }),
      jsxs('div', { className: 'tb-filters', children: [jsxs('label', { className: 'tb-search', children: [jsx('span', { 'aria-hidden': true, children: '⌕' }), jsx('input', { type: 'search', value: search, placeholder: '搜索任务名称…', 'aria-label': '搜索任务', onChange: e => setSearch(e.target.value) })] }),
      jsx('select', { value: labelFilter, 'aria-label': '标签筛选', onChange: e => setLabelFilter(e.target.value), children: [
        jsx('option', { value: '', children: '全部标签' }), ...Object.keys(definitions).map(name => jsx('option', { value: name, children: name }, name))
      ] }),
      jsxs(Dialog, { open: labelsOpen, onOpenChange: setLabelsOpen, children: [
      jsx(DialogTrigger, { asChild: true, children: action('管理标签', () => setLabelsOpen(true), { variant: 'outline' }) }),
      labelsOpen ? jsxs(DialogContent, { className: 'tb-root tb-dialog', banner: failure?.message, children: [
        jsxs(DialogHeader, { children: [jsx(DialogTitle, { children: '管理标签' }), jsx(DialogDescription, { children: '创建标签、调整颜色，或更新现有标签。' })] }),
        jsxs('div', { className: 'tb-label-manager', children: [
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
      ] }), action('完成', () => setLabelsOpen(false), { variant: 'outline' })
      ] }) : null] }),
      jsxs('div', { className: 'tb-view-toggle', role: 'radiogroup', 'aria-label': '任务视图', children: [['board', '▦ 看板'], ['list', '☰ 列表']].map(([value, label]) => action(label, () => { setView(value); taskStorage.set('view', value) }, { role: 'radio', 'aria-checked': view === value, onKeyDown: e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const next = view === 'board' ? 'list' : 'board'; setView(next); taskStorage.set('view', next); e.currentTarget.parentElement.querySelectorAll('[role="radio"]')[next === 'board' ? 0 : 1].focus() } } })) }),
      action('管理状态', () => { setStatusDraft(statuses.map(s => ({ ...s }))); setMigrations({}); setStatusesOpen(true) }),
      syncQuery.data?.available ? action(syncRunning ? '同步中…' : '立即同步', () => run(async () => { const state = await rest('/sync', { method: 'POST' }); setSyncActive(!!state.running); if (state.running) wasSyncing.current = true; await syncQuery.refetch() }), { disabled: busy || syncRunning, children: syncRunning ? jsxs('span', { role: 'status', children: [jsx(Codicon, { name: 'loading', className: 'animate-spin', 'aria-hidden': true }), ' 同步中…'] }) : '立即同步' }) : null,
      action('↻', () => run(() => syncQuery.refetch?.()), { 'aria-label': '刷新', className: 'tb-refresh' })] }),
      syncQuery.error || syncQuery.data?.last_result?.ok === false ? jsx('div', { role: 'alert', className: 'tb-alert', children: syncQuery.error?.message || syncQuery.data.last_result.message }) : null,
      jsx(Dialog, { open: statusesOpen, onOpenChange: setStatusesOpen, children: statusesOpen ? jsxs(DialogContent, { className: 'tb-root tb-dialog', banner: failure?.message, children: [
        jsxs(DialogHeader, { children: [jsx(DialogTitle, { children: '管理状态' }), jsx(DialogDescription, { children: '按顺序推进任务；每种类别至少保留一个状态。删除在用状态时请选择迁移目标。' })] }),
        jsx('div', { className: 'tb-label-manager', style: { maxHeight: '60vh', overflowY: 'auto' }, children: statusDraft.map((status, index) => {
          const patch = fields => setStatusDraft(statusDraft.map(s => s.id === status.id ? { ...s, ...fields } : s))
          const move = delta => { const next = [...statusDraft]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setStatusDraft(next) }
          const used = (query.data?.tasks || []).some(t => t.status === status.id)
          return jsxs('div', { role: 'group', 'aria-label': '状态 ' + status.name, children: [
            jsx('input', { 'aria-label': '状态名称 ' + status.id, maxLength: 40, value: status.name, onChange: e => patch({ name: e.target.value }) }),
            palette(status.color, color => patch({ color })),
            jsx('select', { 'aria-label': '状态类别 ' + status.id, value: status.category, onChange: e => patch({ category: e.target.value }), children: [['todo', '待办类'], ['doing', '进行类'], ['done', '完成类']].map(([value, name]) => jsx('option', { value, children: name }, value)) }),
            action('上移', () => move(-1), { disabled: busy || index === 0, 'aria-label': '上移 ' + status.name }),
            action('下移', () => move(1), { disabled: busy || index === statusDraft.length - 1, 'aria-label': '下移 ' + status.name }),
            used ? jsx('select', { 'aria-label': '迁移目标 ' + status.id, value: migrations[status.id] || '', onChange: e => setMigrations({ ...migrations, [status.id]: e.target.value }), children: [jsx('option', { value: '', children: '选择迁移目标' }), ...statusDraft.filter(s => s.id !== status.id).map(s => jsx('option', { value: s.id, children: s.name }, s.id))] }) : null,
            action('删除状态', () => setStatusDraft(statusDraft.filter(s => s.id !== status.id)), { 'aria-label': '删除状态 ' + status.name, disabled: busy || used && !migrations[status.id] || Object.entries(migrations).some(([id, target]) => target === status.id && !statusDraft.some(s => s.id === id)) })
          ] }, status.id)
        }) }),
        action('添加状态', () => setStatusDraft([...statusDraft, { id: 'status-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), name: '新状态', color: 'blue', category: 'doing' }])),
        action('保存状态', () => run(async () => {
          const surviving = new Set(statusDraft.map(s => s.id))
          await rest('/statuses', { method: 'PUT', body: { statuses: statusDraft, migrations: Object.fromEntries(Object.entries(migrations).filter(([id]) => !surviving.has(id))) } })
          setFilter(''); setStatusesOpen(false)
        }), { variant: 'default' })
      ] }) : null }),
      jsxs('div', { className: 'tb-stats', 'aria-label': '任务统计', children: [jsx('span', { children: tasks.length + ' 个任务' }), ...statuses.map(s => [s.id, s.name]).map(([status, label]) => jsx('span', { children: allTasks.filter(task => task.status === status).length + ' ' + label }, status))] }),
      view === 'list' ? jsxs('div', { className: 'tb-tabs', role: 'tablist', 'aria-label': '任务状态', children: [['', '全部'], ...statuses.map(s => [s.id, s.name])].map(([value, label]) => action(label, () => setFilter(value), { role: 'tab', 'aria-selected': filter === value })) }) : null,
      error || failure || query.isError || labelsQuery.isError ? jsx('div', { className: 'tb-alert', role: 'alert', children: failure?.message || error || '加载失败' }) : null,
      jsx(Dialog, { open: !!editing, onOpenChange: open => { if (!open && !busyRef.current) setEditing(null) }, children: editing ? jsxs(DialogContent, { className: 'tb-root tb-dialog', banner: failure?.message, onCloseAutoFocus: restoreFocus, children: [
      jsxs(DialogHeader, { children: [jsx(DialogTitle, { children: editing === 'new' ? '新建任务' : '编辑任务' }), jsx(DialogDescription, { children: '填写任务目标，标签和关联信息可随时调整。' })] }),
      jsxs('form', { className: 'tb-task-form', onSubmit: e => { e.preventDefault(); return run(async () => {
        await rest(editing === 'new' ? '/tasks' : '/tasks/' + editing, { method: editing === 'new' ? 'POST' : 'PATCH', body: draft }); setEditing(null)
      }) }, children: [
        ...[['title', '标题'], ['ref', '任务编号(ref)'], ['note', '备注'], ['url', '链接(url)']].map(([key, label]) => jsxs('label', { className: 'tb-field', children: [jsx('span', { children: label }), jsx(key === 'note' ? 'textarea' : 'input', {
          'aria-label': label, placeholder: key === 'title' ? '输入一个清晰的任务目标' : label, required: key === 'title', type: key === 'url' ? 'url' : 'text', value: draft[key], onChange: e => setDraft({ ...draft, [key]: e.target.value }) })] }, key)),
        jsx('div', { className: 'tb-labels', role: 'group', 'aria-label': '任务标签', children: Object.entries(definitions).map(([name, color]) => jsx('button', {
          type: 'button', className: 'tb-label-choice', disabled: busy, 'aria-pressed': draft.labels.includes(name), onClick: () => setDraft({ ...draft, labels: draft.labels.includes(name) ? draft.labels.filter(label => label !== name) : [...draft.labels, name] }), children: labelChip(name, color)
        }, name)) }),
        jsxs('div', { className: 'tb-dialog-actions tb-form-actions', children: [action('取消', () => setEditing(null), { type: 'button' }), jsx(Button, { type: 'submit', size: 'sm', disabled: busy, children: '保存' })] })
      ] })
      ] }) : null }),
      jsx(Dialog, { open: !!selected, onOpenChange: open => { if (!open) setSelectedId(null) }, children: selected ? jsxs(DialogContent, { className: 'tb-root tb-dialog', banner: failure?.message, onCloseAutoFocus: restoreFocus, children: [
        jsxs(DialogHeader, { children: [jsx(DialogTitle, { children: selected.title }), jsx(DialogDescription, { children: selected.ref || '任务详情' })] }),
        selected.note ? jsx('p', { className: 'tb-detail-note', children: selected.note }) : null,
        jsx('div', { className: 'tb-labels', children: (selected.labels || []).map(name => labelChip(name, definitions[name])) }),
        jsx('select', { 'aria-label': '更新任务状态', disabled: busy, value: selected.status, onChange: event => run(() => update(selected, { status: event.target.value })), children: statuses.map(s => [s.id, s.name]).map(([value, label]) => jsx('option', { value, children: label }, value)) }),
        jsxs('div', { className: 'tb-dialog-actions', children: [action('关闭', () => setSelectedId(null)), action('编辑任务', () => { setSelectedId(null); edit(selected) }, { variant: 'outline' })] })
      ] }) : null }),
      jsx(Dialog, { open: !!deleting, onOpenChange: open => { if (!open && !busyRef.current) setDeleting(null) }, children: deleting ? jsxs(DialogContent, { className: 'tb-root tb-dialog', banner: failure?.message, onCloseAutoFocus: restoreFocus, children: [
        jsxs(DialogHeader, { children: [jsx(DialogTitle, { children: '删除任务' }), jsx(DialogDescription, { children: '确定删除「' + deleting.title + '」？关联会话会保留。' })] }),
        jsxs('div', { className: 'tb-dialog-actions', children: [action('取消', () => setDeleting(null)), action('确认删除', () => run(async () => { await rest('/tasks/' + deleting.id, { method: 'DELETE' }); setDeleting(null) }), { variant: 'destructive' })] })
      ] }) : null }),
      query.isLoading ? jsx('div', { role: 'status', children: '加载任务…' }) : null,
      canRenderTasks && view === 'list' ? jsx('div', { className: 'tb-task-list', 'aria-label': '任务列表', children: tasks.length ? tasks.map(renderTask) : jsx(EmptyState, { title: search || labelFilter || filter !== '' ? '没有匹配的任务' : '暂无任务', description: '调整筛选条件，或新建一个任务。' }) }) : null,
      canRenderTasks && view === 'board' ? jsx('div', { className: 'tb-task-columns', children: statuses.map(s => [s.id, s.name]).map(([status, label]) => jsxs('section', {
        className: cn('tb-task-zone', dropTarget === status && 'tb-drop-target'), 'aria-label': label,
        onDragOver: e => {
          if (!draggedTask.current || draggedTask.current.status === status || busyRef.current) return
          e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget(status); setInsertion(null)
        },
        onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null) },
        onDrop: e => {
          e.preventDefault()
          const task = draggedTask.current
          draggedTask.current = null; setDragging(null); setDropTarget(null); setInsertion(null)
          if (task && task.status !== status) return run(() => update(task, { status }))
        },
        children: [jsxs('div', { className: 'tb-column-head', children: [jsx('span', { className: 'tb-label-dot', style: { backgroundColor: labelPalette[statuses.find(s => s.id === status)?.color] } }), jsx('strong', { children: label }), jsx('span', { className: 'tb-count', children: tasks.filter(t => t.status === status).length }), action('＋', event => edit(null, status, event), { 'aria-label': '新建' + label + '任务' })] }),
          !tasks.some(t => t.status === status) ? jsxs('div', { className: 'tb-empty', children: [
            jsx('span', { className: 'tb-empty-icon', 'aria-hidden': true, children: category(status) === 'done' ? '✓' : '＋' }),
            jsx('strong', { children: search || labelFilter ? '没有匹配的任务' : category(status) === 'done' ? '完成的每一步，都值得记录' : '这里还没有任务' }),
            jsx('p', { children: search || labelFilter ? '试试其他关键词或标签。' : category(status) === 'done' ? '完成任务后，会自动收纳到这里。' : '添加一个任务，开始推进你的计划。' })
          ] }) : null,
          ...tasks.filter(t => t.status === status).map(renderTask), action('＋ 添加任务', event => edit(null, status, event), { className: 'tb-add-task', 'aria-label': '添加' + label + '任务' })
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
    taskStorage = ctx.storage
    taskFetch = (path, options) => ctx.rest(path, options)
    openExternal = (url) => ctx.os.openExternal(url)
    ctx.register({ id: 'tasks-page', area: ROUTES_AREA, data: { path: '/tasks' }, render: () => jsx(TasksPage, {}) })
    ctx.register({ id: 'tasks-nav', area: SIDEBAR_NAV_AREA, data: { path: '/tasks', label: 'Task Board', codicon: 'checklist' } })
    ctx.register({ id: 'tasks-open', area: PALETTE_AREA, data: { id: 'task-board-open', label: 'Task Board：打开任务清单', run: () => host.navigate('/tasks') } })
  }
}
