/**
 * dev-board — cross-repo worktree board, linked to the current session.
 * Sidebar page: full board. Workspace dock (right of chat): repo tree + unified diff
 * for the FOCUSED session's ZT task — visible while you chat.
 */
import { cn, host, useQuery, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, EmptyState, ScrollArea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusDot } from '@hermes/plugin-sdk'


function taskPrefix(id, map = {}) {
  const list = map[id] || []
  const profile = host.state.focusedSessionProfile?.get() || host.state.profile?.get() || 'default'
  return (list.find((s) => s.profile === profile) || list[0])?.label || '#' + id
}

const REFRESH_MS = 15000
let boardFetch = null
const rest = (path, options) => boardFetch(path, options)

function useBoard() {
  return useQuery({ queryKey: ['dev-board'], queryFn: () => rest('/board'), refetchInterval: REFRESH_MS })
}
function useSessions() {
  return useQuery({ queryKey: ['dev-board-sessions'], queryFn: () => rest('/zt_sessions'), refetchInterval: 60000 })
}
function useChanges(dir) {
  return useQuery({ queryKey: ['dev-board-changes', dir], queryFn: () => rest('/changes?dir=' + encodeURIComponent(dir)), enabled: !!dir })
}
function useDiff(dir, file) {
  return useQuery({ queryKey: ['dev-board-diff', dir, file], queryFn: () => rest('/diff?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file)), enabled: !!(dir && file) })
}

function activeTask(map) {
  const sid = host.state.focusedStoredSessionId?.get() || host.state.focusedSessionId?.get()
  const profile = host.state.focusedSessionProfile?.get() || host.state.profile?.get() || 'default'
  if (!sid) return null
  for (const [id, list] of Object.entries(map)) {
    const session = list.find((s) => (s.profile || 'default') === profile && (s.id === sid || s.session_ids?.includes(sid)))
    if (session) return { id, session }
  }
  return null
}

function useActiveZt() {
  const sessions = useSessions()
  const [active, setActive] = useState(null)
  useEffect(() => {
    const compute = () => setActive(activeTask(sessions.data?.zt_sessions || {}))
    const atoms = [host.state.focusedStoredSessionId, host.state.focusedSessionId, host.state.focusedSessionProfile, host.state.profile]
    compute()
    const dispose = atoms.filter((atom) => atom?.subscribe).map((atom) => atom.subscribe(compute))
    return () => dispose.forEach((fn) => fn())
  }, [sessions.data])
  return { ...sessions, active }
}

async function openDock(map) {
  try {
    const active = activeTask(map || (await rest('/zt_sessions')).zt_sessions || {})
    if (active) await host.openSession(active.session.id, { profile: active.session.profile || 'default' })
    else host.navigate('/')
    await host.openWorkspace('worktree', {
      dock: { pane: 'workspace', pos: 'right' }, title: 'Worktree', minWidth: '24rem',
      render: () => jsx(DockPanel, {})
    })
  } catch (error) {
    host.notify({ kind: 'error', message: '打开会话侧栏失败：' + (error.message || String(error)) })
  }
}

async function openEditor(task) {
  try {
    const result = await rest('/open_editor?task=' + encodeURIComponent(task), { method: 'POST', timeoutMs: 20000 })
    if (!result.ok) throw new Error(result.detail || '编辑器命令未成功完成')
    host.notify({ kind: 'success', message: '编辑器打开命令已完成' })
  } catch (error) {
    host.notify({ kind: 'error', message: '打开编辑器失败：' + (error.message || String(error)) })
  }
}

const statusVariant = (s) => (s.startsWith('?') ? 'warning' : s.startsWith('D') ? 'destructive' : s.startsWith('A') ? 'success' : 'secondary')

// Colored unified-diff renderer. Expects raw `git diff` text.
function DiffView({ text }) {
  const lines = (text || '(无差异)').split('\n')
  const rows = []
  let oldNo = 0
  let newNo = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const hunk = l.startsWith('@@')
    if (hunk) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l)
      if (m) { oldNo = +m[1]; newNo = +m[2] }
    }
    let cls = 'text-(--ui-text-secondary)'
    let style = null
    let sign = ''
    let o = '', n = ''
    if (l.startsWith('diff --git') || l.startsWith('index ')) {
      cls = 'text-(--ui-text-tertiary) whitespace-pre-wrap break-all'
      rows.push(jsxs('div', { className: 'flex px-1 py-1 ' + cls, children: [jsx('span', { className: 'flex-1', children: l })] }, i))
      continue
    }
    if (l.startsWith('---') || l.startsWith('+++')) { style = { color: 'var(--ui-accent)' }; o = ''; n = '' }
    else if (hunk) { style = { color: 'var(--ui-accent)', background: 'color-mix(in srgb, var(--ui-accent) 12%, transparent)' }; o = ''; n = '' }
    else if (l.startsWith('+')) { style = { color: 'var(--ui-green)', background: 'color-mix(in srgb, var(--ui-green) 10%, transparent)' }; sign = '+'; n = newNo++; o = '' }
    else if (l.startsWith('-')) { style = { color: 'var(--ui-red)', background: 'color-mix(in srgb, var(--ui-red) 10%, transparent)' }; sign = '-'; o = oldNo++; n = '' }
    else { sign = ' '; o = oldNo++; n = newNo++ }
    rows.push(jsxs('div', {
      className: 'flex font-mono text-[0.6875rem] leading-4 ' + cls,
      style: style,
      children: [
        jsx('span', { className: 'w-8 shrink-0 text-right pr-1 text-(--ui-text-tertiary) select-none', children: o || '' }),
        jsx('span', { className: 'w-8 shrink-0 text-right pr-1 text-(--ui-text-tertiary) select-none', children: n || '' }),
        jsx('span', { className: 'w-3 shrink-0 select-none', children: sign }),
        jsx('span', { className: 'flex-1 whitespace-pre-wrap break-all', children: l.slice(sign === ' ' ? 1 : 1) })
      ]
    }, i))
  }
  return jsx('div', { className: 'py-1', children: rows })
}

// ─── Workspace dock panel: chat-side companion ───────────────────────────────
// Tree building (single-child chains compacted) — same pattern as the app's
// review file tree.
function buildTree(files) {
  const root = { name: '', dirs: new Map(), files: [] }
  for (const f of files) {
    const segs = f.path.split('/').filter(Boolean)
    const name = segs.pop() ?? f.path
    let dir = root
    let prefix = ''
    for (const s of segs) {
      prefix = prefix ? prefix + '/' + s : s
      if (!dir.dirs.has(s)) dir.dirs.set(s, { name: s, id: prefix, dirs: new Map(), files: [] })
      dir = dir.dirs.get(s)
    }
    dir.files.push({ ...f, name })
  }
  // compact: merge nodes with a single dir child and no files
  const compact = (node) => {
    for (const [k, child] of node.dirs) {
      compact(child)
      if (child.files.length === 0 && child.dirs.size === 1) {
        const [gk, grand] = [...child.dirs][0]
        node.dirs.set(k, { ...grand, name: child.name + '/' + grand.name })
      }
    }
  }
  compact(root)
  const toRows = (node, depth, prefix, out) => {
    for (const child of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const total = countAll(child)
      out.push({ type: 'dir', key: prefix + child.name, name: child.name, depth, added: total.added, removed: total.removed, node: child })
      // children rendered when expanded (handled by caller)
    }
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ type: 'file', key: prefix + f.path, ...f, depth })
    }
    return out
  }
  const countAll = (node) => {
    let added = 0, removed = 0
    for (const f of node.files) { added += f.added; removed += f.removed }
    for (const c of node.dirs.values()) { const t = countAll(c); added += t.added; removed += t.removed }
    return { added, removed }
  }
  return { root, toRows, countAll }
}

function TreeRow({ row, expanded, onToggle, onPick, pickedKey }) {
  const common = 'flex items-center gap-1 rounded px-1 py-0.5 text-xs cursor-pointer hover:bg-(--chrome-action-hover)'
  if (row.type === 'dir') {
    return jsxs('div', {
      className: common + (expanded.has(row.key) ? ' bg-(--chrome-action-hover)/50' : ''),
      style: { paddingLeft: 4 + row.depth * 12 },
      onClick: onToggle,
      children: [
        jsx('span', { className: 'text-(--ui-text-tertiary) w-3', children: expanded.has(row.key) ? '▾' : '▸' }),
        jsx('span', { className: 'truncate', children: row.name }),
        row.added || row.removed ? jsxs('span', { className: 'ml-auto tabular-nums text-[0.625rem]', children: [
          row.added ? jsx('span', { style: { color: 'var(--ui-green)' }, children: '+' + row.added }) : null,
          row.removed ? jsx('span', { style: { color: 'var(--ui-red)' }, children: ' −' + row.removed }) : null
        ]}) : null
      ]
    })
  }
  const st = row.status
  const stColor = st === '?' ? 'var(--ui-text-tertiary)' : st === 'D' ? 'var(--ui-red)' : st === 'A' ? 'var(--ui-green)' : 'var(--ui-text-secondary)'
  return jsxs('div', {
    className: common + (pickedKey === row.key ? ' bg-(--chrome-action-hover)' : ''),
    style: { paddingLeft: 4 + row.depth * 12 + 14 },
    onClick: onPick,
    children: [
      jsx('span', { className: 'w-3 text-center font-semibold shrink-0', style: { color: stColor }, children: st === '?' ? 'U' : st }),
      jsx('span', { className: 'truncate', children: row.name }),
      (row.added || row.removed) ? jsxs('span', { className: 'ml-auto tabular-nums text-[0.625rem] shrink-0', children: [
        row.added ? jsx('span', { style: { color: 'var(--ui-green)' }, children: '+' + row.added }) : null,
        row.removed ? jsx('span', { style: { color: 'var(--ui-red)' }, children: ' −' + row.removed }) : null
      ]}) : null
    ]
  })
}

// Side-by-side rows from a unified diff: aligned old/new sequences per hunk.
function buildSideBySide(text) {
  const rows = []
  let oldNo = 0, newNo = 0, oldBuf = [], newBuf = []
  const flush = () => {
    const n = Math.max(oldBuf.length, newBuf.length)
    for (let i = 0; i < n; i++) {
      rows.push({ o: oldBuf[i] || null, n: newBuf[i] || null, kind: oldBuf[i] && newBuf[i] ? 'mod' : oldBuf[i] ? 'del' : 'add' })
    }
    oldBuf = []; newBuf = []
  }
  for (const l of (text || '').split('\n')) {
    if (l.startsWith('@@')) {
      flush()
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l)
      if (m) { oldNo = +m[1]; newNo = +m[2] }
      rows.push({ hunk: l })
      continue
    }
    if (l.startsWith('diff --git') || l.startsWith('index ') || l.startsWith('--- ') || l.startsWith('+++ ') || l.startsWith('new file')) continue
    if (l.startsWith('-')) oldBuf.push({ no: oldNo++, text: l.slice(1) })
    else if (l.startsWith('+')) newBuf.push({ no: newNo++, text: l.slice(1) })
    else { flush(); rows.push({ o: { no: oldNo++, text: l.slice(1) }, n: { no: newNo++, text: l.slice(1) }, kind: 'ctx' }) }
  }
  flush()
  return rows
}

function FileCompare({ dir, file, diff }) {
  const rows = buildSideBySide(diff)
  const cell = (side, row) => {
    const line = row ? row[side] : null
    const kind = row && !row.hunk ? row.kind : null
    let bg = 'transparent', color = 'var(--ui-text-secondary)'
    if (kind === 'ctx') { /* default */ }
    else if (kind === 'add') { if (side === 'n') { bg = 'rgba(46,160,67,.14)'; color = 'var(--ui-green)' } }
    else if (kind === 'del') { if (side === 'o') { bg = 'rgba(248,81,73,.14)'; color = 'var(--ui-red)' } }
    else if (kind === 'mod') { if (side === 'n') { bg = 'rgba(46,160,67,.14)' } else { bg = 'rgba(248,81,73,.14)' } }
    return jsxs('div', {
      className: 'flex font-mono text-[0.6875rem] leading-[1.15rem] min-w-0',
      style: { background: line ? bg : 'rgba(128,128,128,.06)' },
      children: [
        jsx('span', { className: 'w-9 shrink-0 text-right pr-1.5 select-none text-(--ui-text-tertiary) tabular-nums', children: line ? line.no : '' }),
        jsx('span', { className: 'flex-1 whitespace-pre-wrap break-all px-1', style: { color }, children: line ? line.text : '' })
      ]
    })
  }
  return jsxs('div', { className: 'h-full flex flex-col min-h-0', children: [
    jsxs('div', { className: 'flex items-center gap-2 px-2 py-1 border-b border-(--ui-stroke-secondary)', children: [
      jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => window.dispatchEvent(new CustomEvent('dev-board-back')), children: '← 返回' }),
      jsx('span', { className: 'text-xs truncate', children: file })
    ]}),
    jsxs('div', { className: 'flex-1 min-h-0 flex text-[0] ', children: [
      jsx(ScrollArea, { className: 'flex-1 min-w-0 border-r border-(--ui-stroke-secondary) h-full', children: jsx('div', { children: rows.map((r, i) => r.hunk
        ? jsx('div', { className: 'px-2 py-0.5 text-[0.625rem] font-mono', style: { color: 'var(--ui-accent)', background: 'color-mix(in srgb, var(--ui-accent) 10%, transparent)' }, children: r.hunk }, i)
        : cell('o', r)) }) }),
      jsx(ScrollArea, { className: 'flex-1 min-w-0 h-full', children: jsx('div', { children: rows.map((r, i) => r.hunk
        ? jsx('div', { className: 'px-2 py-0.5 text-[0.625rem] font-mono', style: { color: 'var(--ui-accent)', background: 'color-mix(in srgb, var(--ui-accent) 10%, transparent)' }, children: r.hunk.replace(/@@(.*)@@/, '@@') }, i)
        : cell('n', r)) }) })
    ]})
  ]})
}

function DockPanel() {
  const board = useBoard()
  const sessions = useActiveZt()
  const [selectedTask, setSelectedTask] = useState('auto')
  const activeZt = selectedTask === 'auto' ? sessions.active?.id : selectedTask
  const [repoFilter, setRepoFilter] = useState('all')
  const [expanded, setExpanded] = useState(() => new Set())
  const [picked, setPicked] = useState(null) // {dir, path, repo}
  const task = (board.data?.tasks || []).find((t) => t.id === activeZt)
  const tc = useQuery({
    queryKey: ['dev-board-task-changes', activeZt],
    queryFn: () => rest('/task_changes?task=' + encodeURIComponent(activeZt || '')),
    enabled: !!activeZt
  })
  const fileDiff = useDiff(picked?.dir, picked?.path)
  useEffect(() => { setExpanded(new Set()); setPicked(null); setRepoFilter('all') }, [activeZt])
  useEffect(() => {
    const back = () => setPicked(null)
    window.addEventListener('dev-board-back', back)
    return () => window.removeEventListener('dev-board-back', back)
  }, [])
  const taskSelector = jsx('div', { className: 'px-2 py-1.5 border-b border-(--ui-stroke-secondary)', children: jsx(Select, {
    value: selectedTask, onValueChange: setSelectedTask,
    children: [
      jsx(SelectTrigger, { className: 'h-7 text-xs w-full', children: jsx(SelectValue, { placeholder: '选择任务' }) }),
      jsx(SelectContent, { children: [
        jsx(SelectItem, { value: 'auto', children: '跟随当前会话' }),
        ...(board.data?.tasks || []).map((t) => jsx(SelectItem, { value: t.id, children: taskPrefix(t.id, sessions.data?.zt_sessions) }, t.id))
      ]})
    ]
  }) })
  const panel = (content) => jsxs('div', { className: 'h-full flex flex-col min-h-0', children: [taskSelector, content] })
  const state = (title, description) => panel(jsx(EmptyState, { title, description }))
  if (board.isLoading || (selectedTask === 'auto' && sessions.isLoading)) return state('加载任务和会话…')
  if (board.isError) return state('任务加载失败', board.error?.message)
  if (selectedTask === 'auto' && sessions.isError) return state('会话映射加载失败', (sessions.error?.message || '') + '；可手动选择任务')
  if (!activeZt) return state('当前会话未匹配任务', '请从上方手动选择任务，或打开含任务编号的会话')
  if (!task) return state(taskPrefix(activeZt, sessions.data?.zt_sessions) + ' 无活跃 worktree', '可从上方选择其他任务')
  if (tc.isLoading) return state('加载任务变更…')
  if (tc.isError) return state('任务变更加载失败', tc.error?.message)
  const files = (tc.data?.files || []).filter((f) => repoFilter === 'all' || f.repo === repoFilter)
  const repos = tc.data?.repos || []

  // file picked → file compare view
  if (picked) {
    return panel(jsx(FileCompare, { dir: picked.dir, file: picked.repo + ' · ' + picked.path, diff: fileDiff.data?.diff }))
  }

  // tree rows
  const tree = buildTree(files)
  const rows = []
  const walk = (node, depth, prefix) => {
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
    for (const child of dirs) {
      const key = prefix + child.name + '/'
      const total = tree.countAll(child)
      rows.push({ type: 'dir', key, name: child.name, depth, added: total.added, removed: total.removed })
      if (expanded.has(key)) walk(child, depth + 1, key)
    }
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ type: 'file', key: prefix + f.path, path: f.path, dir: f.dir, repo: f.repo, status: f.status, added: f.added, removed: f.removed, name: f.name, depth: depth + 1 })
    }
  }
  walk(tree.root, 0, '')

  return jsxs('div', { className: 'h-full flex flex-col min-h-0', children: [
    taskSelector,
    jsxs('div', { className: 'flex items-center gap-2 px-2 py-1.5 border-b border-(--ui-stroke-secondary) flex-wrap', children: [
      jsx('span', { className: 'font-semibold text-sm', children: taskPrefix(activeZt, sessions.data?.zt_sessions) }),
      jsx(Select, {
        value: repoFilter,
        onValueChange: (v) => { setRepoFilter(v); setExpanded(new Set()) },
        children: [
          jsx(SelectTrigger, { className: 'h-6 text-xs w-[9.5rem]', children: jsx(SelectValue, {}) }),
          jsx(SelectContent, { children: [
            jsx(SelectItem, { value: 'all', children: '全部（' + (tc.data?.files || []).length + ' 变更）' }),
            ...repos.map((r) => jsx(SelectItem, { value: r.repo, children: r.repo + '（' + r.dirty + '）' }, r.repo))
          ]})
        ]
      }),
      jsxs('span', { className: 'ml-auto text-[0.625rem] text-(--ui-text-tertiary)', children: [files.length + ' 文件'] })
    ]}),
    jsx(ScrollArea, { className: 'flex-1 min-h-0', children:
      jsxs('div', { className: 'flex flex-col gap-0.5 p-1', children: [
        ...rows.map((row) => row.type === 'dir'
          ? jsx(TreeRow, {
              row, expanded,
              onToggle: () => { const next = new Set(expanded); next.has(row.key) ? next.delete(row.key) : next.add(row.key); setExpanded(next) },
              onPick: null, pickedKey: null
            }, row.key)
          : jsx(TreeRow, {
              row, expanded: new Set(), onToggle: null,
              onPick: () => setPicked({ dir: row.dir, path: row.path, repo: row.repo }),
              pickedKey: null
            }, row.key)),
        !rows.length ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary) px-2 py-1', children: '无未提交变更' }) : null
      ]})
    })
  ]})
}

// ─── Sidebar board page (full board, as before + dock opener) ────────────────
function SessionChip({ s }) {
  return jsx('button', {
    className: 'rounded-full border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover) truncate max-w-[14rem]',
    title: s.title, onClick: async () => {
      try { await host.openSession(s.id, { profile: s.profile || 'default' }) }
      catch (error) { host.notify({ kind: 'error', message: '打开会话失败：' + (error.message || String(error)) }) }
    }, children: s.title
  })
}

function TaskCard({ task, activeZt, onPickRepo, pickedDir }) {
  const sessions = useSessions()
  const chips = (sessions.data?.zt_sessions || {})[task.id] || []
  const isActive = activeZt === task.id
  return jsxs('div', {
    className: cn('rounded-lg border bg-transparent', isActive ? 'border-(--accent)' : 'border-(--ui-stroke-secondary)'),
    children: [
      jsxs('div', { className: 'flex items-center gap-2 px-3 py-2 border-b border-(--ui-stroke-secondary) flex-wrap', children: [
        jsx('span', { className: 'font-semibold', children: taskPrefix(task.id, sessions.data?.zt_sessions) }),
        jsx(Badge, { variant: 'secondary', children: task.repos.length + ' 仓' }),
        isActive ? jsx(Badge, { variant: 'success', children: '当前会话' }) : null,
        chips.length ? jsx('div', { className: 'flex gap-1 flex-wrap', children: chips.map((s) => jsx(SessionChip, { s }, (s.profile || 'default') + ':' + s.id)) }) : null,
        jsxs('div', { className: 'ml-auto flex gap-1', children: [
          jsx(Button, {
            variant: 'ghost', size: 'sm',
            onClick: () => openEditor(task.id),
            children: '编辑器'
          })
        ]})
      ]}),
      jsx('div', { className: 'flex flex-col gap-1 p-2', children: task.repos.map((r) => jsxs('div', {
        className: cn('flex items-center gap-2 rounded-md border border-(--ui-stroke-secondary) px-2 py-1.5 text-[0.8125rem] hover:bg-(--chrome-action-hover) cursor-pointer', pickedDir === r.dir && 'bg-(--chrome-action-hover)'),
        onClick: () => onPickRepo(r),
        children: [
          jsx(StatusDot, { tone: r.dirty > 0 ? 'warn' : 'good' }),
          jsx('span', { className: 'font-medium min-w-[7rem]', children: r.repo }),
          jsx('span', { className: 'text-(--ui-text-tertiary) truncate max-w-[10rem]', children: r.branch || '(detached)' }),
          jsx('span', { className: 'ml-auto text-(--ui-text-tertiary) tabular-nums text-xs whitespace-nowrap', children: r.last || '—' }),
          r.dirty > 0 ? jsx(Badge, { variant: 'warning', children: r.dirty + ' 未提交' }) : null
        ]
      }, r.dir)) })
    ]
  })
}

function BoardPage() {
  const board = useBoard()
  const sessions = useActiveZt()
  const activeZt = sessions.active?.id
  const [pickedDir, setPickedDir] = useState(null)
  if (board.isLoading) return jsx(EmptyState, { title: '加载 worktree…' })
  if (board.isError) return jsx(EmptyState, { title: '后端不可用', description: board.error?.message })
  const tasks = board.data?.tasks || []
  const sorted = activeZt ? [...tasks.filter((t) => t.id === activeZt), ...tasks.filter((t) => t.id !== activeZt)] : tasks
  return jsxs(ScrollArea, { className: 'h-full', children: [
    jsxs('div', { className: 'flex flex-col gap-2 p-3', children: [
      jsxs('div', { className: 'flex items-center gap-2 text-(--ui-text-tertiary) text-xs', children: [
        jsx('span', { children: tasks.length + ' 个任务' + (activeZt ? ' · 当前 ' + taskPrefix(activeZt, sessions.data?.zt_sessions) : '') }),
        jsx(Button, {
          variant: 'secondary', size: 'sm',
          onClick: () => openDock(sessions.data?.zt_sessions || {}),
          children: '在会话右侧打开'
        }),
        jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => board.refetch(), children: '刷新' })
      ]}),
      sorted.map((t) => jsx(TaskCard, { task: t, activeZt, pickedDir, onPickRepo: (r) => setPickedDir(r.dir) }, t.id))
    ]})
  ]})
}

export default {
  id: 'dev-board',
  name: 'Dev Board',
  description: 'Cross-repo worktree board linked to the current session, with a chat-side dock panel.',
  register(ctx) {
    boardFetch = (path, options) => ctx.rest(path, options)
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: '/dev-board' }, render: () => jsx(BoardPage, {}) })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/dev-board', label: 'Dev Board', codicon: 'git-branch' } })
    ctx.register({ id: 'open', area: PALETTE_AREA, data: { id: 'dev-board-open', label: 'Dev Board：打开跨仓开发板', run: () => host.navigate('/dev-board') } })
    ctx.register({
      id: 'open-dock',
      area: PALETTE_AREA,
      data: {
        id: 'dev-board-worktree',
        label: 'Dev Board：会话右侧 Worktree 面板',
        run: () => openDock()
      }
    })
  }
}
