/**
 * dev-board — cross-repo worktree board, linked to the current session.
 * Sidebar page: full board. Workspace dock (right of chat): repo tree + unified diff
 * for the FOCUSED session's ZT task — visible while you chat.
 */
import { cn, host, useQuery, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, EmptyState, ScrollArea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusDot } from '@hermes/plugin-sdk'


function taskPrefix(id, map = {}) {
  const list = map[id] || []
  const profile = host.state.focusedSessionProfile?.get() || host.state.profile?.get() || 'default'
  return (list.find((s) => s.profile === profile) || list[0])?.label || '#' + id
}

const boardStyles = `
.dev-board { min-width:0; width:100%; max-width:100%; box-sizing:border-box; color:var(--ui-text-primary); font-size:12px; }
.dev-board *, .dev-board *::before, .dev-board *::after { box-sizing:border-box; }
.dev-board button, .dev-board input { max-width:100%; font:inherit; }
.dev-board button { cursor:pointer; }
.dev-board button:focus-visible, .dev-board input:focus-visible, .dev-board [tabindex]:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.dev-board button:disabled { cursor:default; opacity:.5; }
.dev-board .db-tasks { padding:12px; display:flex; flex-direction:column; gap:8px; min-width:0; }
.dev-board .db-task-columns { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
.dev-board .db-task-zone { min-width:0; min-height:100px; padding:8px; border:1px solid var(--ui-stroke-secondary); border-radius:8px; }
.dev-board .db-task-zone.db-drop-target { border-color:var(--ui-accent); background:color-mix(in srgb, var(--ui-accent) 10%, transparent); }
.dev-board .db-task-row[draggable="true"] { user-select:none; cursor:grab; }
.dev-board .db-task-row.db-dragging { opacity:0.45; }
@media (max-width:700px) { .dev-board .db-task-columns { grid-template-columns:1fr; } }
.dev-board .db-task-form { flex-wrap:wrap; }
.dev-board .db-task-form input { flex:1 1 100%; }
.dev-board .db-task-row { padding:8px 0; border-bottom:1px solid var(--ui-stroke-secondary); min-width:0; }
.dev-board .db-task-row button { min-width:0; white-space:normal; overflow-wrap:anywhere; }
.dev-board .db-task-id { display:inline-block; min-width:0; max-width:100%; overflow-wrap:anywhere; }
.dev-board .db-task-title { flex:1 1 120px; min-width:0; overflow-wrap:anywhere; font-weight:600; }
.dev-board .db-task-note { white-space:pre-wrap; overflow-wrap:anywhere; color:var(--ui-text-secondary); padding:4px 0; }
.dev-board .db-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-width:0; }
.dev-board .db-title { font-size:14px; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 100%; }
.dev-board .db-card { border:1px solid var(--ui-stroke-secondary); border-radius:8px; overflow:hidden; }
.dev-board .db-card-head { padding:12px 14px; }
.dev-board .db-card-head > * { min-width:0; max-width:100%; }
.dev-board .db-repos { display:flex; flex-direction:column; gap:10px; padding:12px; }
.dev-board .db-repo { min-width:0; padding:10px; border:1px solid var(--ui-stroke-secondary); border-radius:5px; }
.dev-board .db-repo-head { display:flex; align-items:center; gap:6px; width:100%; min-width:0; border:0; background:transparent; color:inherit; text-align:left; padding:0 0 6px; }
.dev-board .db-repo-name { font-size:13px; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dev-board .db-meta { font-size:12px; color:var(--ui-text-tertiary); min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dev-board .db-review { width:100%; min-width:0; font-size:12px; border-top:1px solid var(--ui-stroke-secondary); padding:8px 0 0; margin-top:6px; overflow-wrap:anywhere; }
.dev-board .db-review-head { display:flex; align-items:center; flex-wrap:wrap; gap:4px; color:var(--ui-text-secondary); }
.dev-board .db-review-head > span { flex:1 1 120px; }
.dev-board .db-review-link { display:block; width:100%; border:0; background:transparent; color:var(--ui-accent); text-align:left; padding:5px 0; overflow-wrap:anywhere; }
.dev-board .db-manual, .dev-board form { display:flex; gap:6px; align-items:center; min-width:0; }
.dev-board .db-manual > button:first-child { flex:1; min-width:0; }
.dev-board input { min-width:0; flex:1; padding:5px 6px; border:1px solid var(--ui-stroke-secondary); border-radius:4px; color:var(--ui-text-primary); background:transparent; }
.dev-board .db-section { margin:10px 4px 4px; padding:6px 0; border-bottom:1px solid var(--ui-stroke-secondary); color:var(--ui-text-secondary); font-size:12px; font-weight:600; }
.dev-board .db-tree { display:flex; align-items:center; gap:4px; width:100%; min-width:0; border:0; background:transparent; color:inherit; text-align:left; padding-top:4px; padding-bottom:4px; }
.dev-board .db-tree:hover { background:var(--chrome-action-hover); }
.dev-board .db-tree > span:nth-child(2) { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dev-board .db-tree > span:last-child { flex-shrink:0; }
.dev-board .db-dock-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-width:0; padding:8px; border-bottom:1px solid var(--ui-stroke-secondary); }
.dev-board .db-task-selector { min-width:0; padding:8px; border-bottom:1px solid var(--ui-stroke-secondary); }
.dev-board .db-task-selector button { width:100%; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.dev-board .db-dock-toolbar button { min-width:0; max-width:100%; }
.dev-board .db-dock-review { padding:8px; border-top:1px solid var(--ui-stroke-secondary); }
.dev-board .db-dock-review .db-review { border:0; margin:0; padding:0; }

.dev-board.db-dock .db-task-selector, .dev-board.db-dock .db-dock-toolbar { padding:8px 12px; }
.dev-board.db-dock .db-task-selector { border-bottom:0; padding-bottom:0; }
.dev-board.db-dock .db-dock-toolbar .db-title { flex:1 1 0; font-size:12px; }
.dev-board.db-dock .db-dock-toolbar > button { flex-shrink:0; }
.dev-board.db-dock .db-dock-toolbar > button[role="combobox"] { flex:1 1 100%; width:100%; }
.dev-board.db-dock .db-dock-content { min-width:0; padding:0 12px 12px; }
.dev-board.db-dock .db-section { margin:8px 0 4px; }
.dev-board.db-dock .db-dock-review { padding:8px 0; }
.dev-board.db-dock .db-review-head { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:4px; }
.dev-board.db-dock .db-review-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
.dev-board.db-dock .db-review-status { grid-column:1 / -1; grid-row:2; color:var(--ui-text-tertiary); }
.dev-board.db-dock .db-review-action { width:26px; height:26px; padding:0; }
.dev-board.db-dock .db-clean { padding:4px 0; color:var(--ui-text-tertiary); }

`
const boardStyle = () => jsx('style', { children: boardStyles })

const API_VERSION = 2
const staleBackend = (data) => data && data.api_version !== API_VERSION
const staleNotice = () => jsx(EmptyState, { title: '后端版本不匹配', description: '磁盘插件与运行中的网关 API 版本不一致。请重启加载 Dev Board 的网关，再等待自动刷新或重新加载页面；仅刷新页面不会重载后端路由。' })
const REFRESH_MS = 15000
let boardFetch = null
let openExternal = null
let closeDock = null
let dockLifetime = null
const rest = (path, options) => boardFetch(path, options)

function useReviews(dir, branch) {
  const forceRef = useRef(false)
  const query = useQuery({
    queryKey: ['dev-board-reviews', dir, branch],
    queryFn: () => {
      const force = forceRef.current
      forceRef.current = false
      return rest('/reviews?dir=' + encodeURIComponent(dir) + (force ? '&force=true' : ''), { timeoutMs: 20000 })
    },
    enabled: !!dir, staleTime: 60000, refetchInterval: 60000, retry: false
  })
  return { ...query, refresh: () => { forceRef.current = true; void query.refetch() } }
}

async function openReview(url) {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('无效链接')
    if (!await openExternal(url)) throw new Error('系统未打开链接')
  } catch (error) {
    host.notify({ kind: 'error', message: '打开代码审阅失败：' + (error.message || String(error)) })
  }
}

function ReviewLinks({ repo, showRepo = true, compact = false }) {
  const query = useReviews(repo.dir, repo.branch)
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const data = query.data
  const reviews = data?.reviews || []
  const manual = data?.manual || []
  const status = { ok: '已加载', empty: '无关联审阅', unsupported: '未配置自动查询（可手工添加）', detached: 'Detached HEAD：无法推断来源分支', unsupported_source: '无法确定审阅来源',
    unavailable: '网关未安装审阅 CLI', error: '查询失败', timeout: '查询超时', partial: '结果不完整' }
  const needsBranch = ['detached', 'unsupported_source'].includes(data?.status)
  const message = data?.status === 'detached' ? '当前无法确定来源分支，自动查询及手工关联均需先切换到明确的分支。'
    : data?.status === 'unsupported_source' ? '当前仓库 remote 格式不受支持，请配置有效的仓库 remote 后再查询或手工关联。' : data?.message?.replace(/^(gh|glab) query failed; check CLI login, permissions, host configuration and response format$/, '请检查网关 CLI 登录、权限、主机配置及响应格式')
  const update = async (action, link) => {
    setSaving(true); setError('')
    try {
      const result = await rest('/review_links?dir=' + encodeURIComponent(repo.dir) + '&action=' + action + '&url=' + encodeURIComponent(link),
        { method: 'POST', timeoutMs: 20000 })
      if (!result.ok) throw new Error(result.detail || '保存失败')
      if (action === 'add') { setUrl(''); setAdding(false) }
      const refreshed = await query.refetch()
      if (refreshed?.isError) throw refreshed.error
    } catch (failure) { setError(failure.message || String(failure)) }
    finally { setSaving(false) }
  }
  return jsxs('div', { className: 'db-review',
    title: compact ? repo.repo + ' · ' + (repo.branch || '(detached)') : undefined,
    onClick: (event) => event.stopPropagation(), children: [
      jsxs('div', { className: 'db-review-head', children: [
        compact && showRepo ? jsx('span', { className: 'db-review-name', title: repo.repo, children: repo.repo }) : null,
        jsx('span', { className: compact ? 'db-review-status' : undefined, children: (compact ? '' : '代码审阅 · ' + (showRepo ? repo.repo + ' · ' : '')) + (query.isLoading ? '加载中…' : query.isError ? '请求失败' :
          (!compact || ['ok', 'empty'].includes(data?.status) ? (reviews.length + manual.length) + ' · ' : '') + (status[data?.status] || '等待加载')) }),
        jsx(Button, { variant: 'ghost', size: 'sm', className: compact ? 'db-review-action' : undefined,
          title: compact ? '刷新 ' + repo.repo + ' 审阅' : undefined, 'aria-label': compact ? '刷新 ' + repo.repo + ' 审阅' : undefined,
          disabled: query.isFetching, onClick: query.refresh, children: compact ? '↻' : '刷新审阅' }),
        jsx(Button, { variant: 'ghost', size: 'sm', className: compact ? 'db-review-action' : undefined,
          title: compact ? '为 ' + repo.repo + ' 添加链接' : undefined, 'aria-label': compact ? '为 ' + repo.repo + ' 添加链接' : undefined,
          disabled: needsBranch, onClick: () => setAdding(!adding), children: compact ? '+' : '添加链接' })
      ]}),
      query.isError ? jsx('div', { role: 'alert', children: query.error?.message || '审阅请求失败' }) : null,
      data?.message && !['ok', 'empty', 'unsupported', 'unavailable', 'timeout', 'partial'].includes(data.status) ? jsx('div', { children: message }) : null,
      ...reviews.map((r) => jsx('button', { type: 'button', className: 'db-review-link',
        onClick: () => openReview(r.url), children: (r.provider === 'gitlab' ? 'MR !' : 'PR #') + r.number + ' ' + r.title +
          ' → ' + r.target_branch + ' · ' + ({ merged: '已合并', open: '待合并', opened: '待合并', closed: '已关闭' }[r.state] || r.state) + (r.draft ? ' · 草稿' : '') }, r.provider + ':' + r.number)),
      ...manual.map((link) => jsxs('div', { className: 'db-manual', children: [
        jsx('button', { type: 'button', className: 'db-review-link', onClick: () => openReview(link), children: '手工 · ' + link }),
        jsx(Button, { variant: 'ghost', size: 'sm', disabled: saving, onClick: () => update('remove', link), children: '移除' })
      ] }, link)),
      adding && !needsBranch ? jsxs('form', { className: 'flex gap-1', onSubmit: (event) => { event.preventDefault(); if (!saving) return update('add', url) }, children: [
        jsx('input', { type: 'url', required: true, value: url, placeholder: 'https://…', 'aria-label': '代码审阅链接',
          className: 'min-w-0 flex-1 border rounded px-1', onChange: (event) => setUrl(event.target.value) }),
        jsx(Button, { type: 'submit', variant: 'secondary', size: 'sm', disabled: saving, children: '保存' })
      ]}) : null,
      error ? jsx('div', { role: 'alert', children: error }) : null
    ] })
}

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
  const lifetime = dockLifetime
  try {
    const active = activeTask(map || (await rest('/zt_sessions')).zt_sessions || {})
    if (!lifetime?.active) return
    if (active) await host.openSession(active.session.id, { profile: active.session.profile || 'default' })
    else host.navigate('/')
    if (!lifetime?.active) return
    closeDock = host.openWorkspace('worktree', {
      dock: { pane: 'workspace', pos: 'right' }, title: 'Worktree', minWidth: '24rem',
      render: () => jsx(DockPanel, {})
    })
  } catch (error) {
    host.notify({ kind: 'error', message: '打开会话侧栏失败：' + (error.message || String(error)) })
  }
}

async function openEditor(task, editorName = 'VS Code') {
  try {
    const result = await rest('/open_editor?task=' + encodeURIComponent(task), { method: 'POST', timeoutMs: 20000 })
    if (!result.ok) throw new Error(result.detail || editorName + ' 打开命令未成功完成')
    host.notify({ kind: 'success', message: (result.editor_name || editorName) + ' 打开命令已完成' })
  } catch (error) {
    host.notify({ kind: 'error', message: '打开 ' + editorName + ' 失败：' + (error.message || String(error)) })
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
    return jsxs('button', {
      type: 'button', 'aria-expanded': expanded.has(row.key), title: row.name,
      className: 'db-tree ' + common + (expanded.has(row.key) ? ' bg-(--chrome-action-hover)/50' : ''),
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
  return jsxs('button', {
    type: 'button', title: row.path || row.name,
    className: 'db-tree ' + common + (pickedKey === row.key ? ' bg-(--chrome-action-hover)' : ''),
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
    else if (kind === 'add') { if (side === 'n') { bg = 'color-mix(in srgb, var(--ui-green) 14%, transparent)'; color = 'var(--ui-green)' } }
    else if (kind === 'del') { if (side === 'o') { bg = 'color-mix(in srgb, var(--ui-red) 14%, transparent)'; color = 'var(--ui-red)' } }
    else if (kind === 'mod') { if (side === 'n') { bg = 'color-mix(in srgb, var(--ui-green) 14%, transparent)' } else { bg = 'color-mix(in srgb, var(--ui-red) 14%, transparent)' } }
    return jsxs('div', {
      className: 'flex font-mono text-[0.6875rem] leading-[1.15rem] min-w-0',
      style: { background: line ? bg : 'color-mix(in srgb, var(--ui-text-tertiary) 6%, transparent)' },
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
  const taskTitle = (sessions.data?.zt_sessions?.[activeZt] || []).find((s) => s.profile === (host.state.focusedSessionProfile?.get() || host.state.profile?.get() || 'default'))?.title || (sessions.data?.zt_sessions?.[activeZt] || [])[0]?.title || taskPrefix(activeZt, sessions.data?.zt_sessions)
  const taskSelector = jsx('div', { className: 'db-task-selector', children: jsx(Select, {
    value: selectedTask, onValueChange: setSelectedTask,
    children: [
      jsx(SelectTrigger, { className: 'h-7 text-xs w-full', children: jsx(SelectValue, { placeholder: '选择任务' }) }),
      jsx(SelectContent, { children: [
        jsx(SelectItem, { value: 'auto', children: '跟随当前会话' }),
        ...(board.data?.tasks || []).map((t) => jsx(SelectItem, { value: t.id, children: taskPrefix(t.id, sessions.data?.zt_sessions) }, t.id))
      ]})
    ]
  }) })
  const panel = (content) => jsxs('div', { className: 'dev-board db-dock h-full flex flex-col min-h-0', children: [boardStyle(), taskSelector, content] })
  const state = (title, description) => panel(jsx(EmptyState, { title, description }))
  if (board.isLoading || (selectedTask === 'auto' && sessions.isLoading)) return state('加载任务和会话…')
  if (board.isError) return state('任务加载失败', board.error?.message)
  if (staleBackend(board.data)) return panel(staleNotice())
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
  const tree = buildTree(files.map((f) => ({ ...f, path: repoFilter === 'all' ? f.repo + '/' + f.path : f.path, originalPath: f.path })))
  const rows = []
  const walk = (node, depth, prefix) => {
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
    for (const child of dirs) {
      const key = prefix + child.name + '/'
      const total = tree.countAll(child)
      rows.push({ type: 'dir', key, name: child.name, depth, added: total.added, removed: total.removed })
      if ((repoFilter === 'all' && depth === 0) || expanded.has(key)) walk(child, depth + 1, key)
    }
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ type: 'file', key: prefix + f.path, path: f.originalPath, dir: f.dir, repo: f.repo, status: f.status, added: f.added, removed: f.removed, name: f.name, depth: depth + 1 })
    }
  }
  walk(tree.root, 0, '')

  return jsxs('div', { className: 'dev-board db-dock h-full flex flex-col min-h-0', children: [
    boardStyle(), taskSelector,
    jsxs('div', { className: 'db-dock-toolbar', children: [
      jsx('span', { className: 'db-title', title: taskTitle, children: taskTitle }),
      jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => openEditor(task.id, board.data?.editor_name || 'VS Code'), children: '在 ' + (board.data?.editor_name || 'VS Code') + ' 打开' }),
      jsx(Select, {
        value: repoFilter,
        onValueChange: (v) => { setRepoFilter(v); setExpanded(new Set()) },
        children: [
          jsx(SelectTrigger, { className: 'h-6 text-xs w-[9.5rem]', children: jsx(SelectValue, {}) }),
          jsx(SelectContent, { children: [
            jsx(SelectItem, { value: 'all', children: (tc.data?.files || []).length ? '全部（' + tc.data.files.length + ' 变更）' : '全部仓库' }),
            ...repos.map((r) => jsx(SelectItem, { value: r.repo, children: r.repo + (r.dirty ? '（' + r.dirty + '）' : '') }, r.repo))
          ]})
        ]
      }),
      files.length ? jsx('span', { className: 'db-meta', children: files.length + ' 文件' }) : null
    ]}),
    jsx(ScrollArea, { className: 'flex-1 min-h-0', children:
      jsxs('div', { className: 'db-dock-content flex flex-col gap-0.5', children: [
        jsx('h3', { className: 'db-section', children: '文件变更' }),
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
        !rows.length ? jsx('div', { className: 'db-clean', children: '无未提交变更' }) : null,
        jsx('h3', { className: 'db-section', children: 'PR/MR' }),
        ...task.repos.filter((r) => repoFilter === 'all' || r.repo === repoFilter).map((r) => jsx('div', { className: 'db-dock-review', children: jsx(ReviewLinks, { repo: r, compact: true }) }, r.dir))
      ]})
    })
  ]})
}

// ─── Sidebar board page (full board, as before + dock opener) ────────────────
async function openTaskSession(s) {
  try { await host.openSession(s.id, { profile: s.profile || 'default' }) }
  catch (error) { host.notify({ kind: 'error', message: '打开会话失败：' + (error.message || String(error)) }) }
}

function SessionChip({ s }) {
  return jsx('button', {
    className: 'rounded-full border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover) truncate max-w-[14rem]',
    title: s.title, onClick: () => openTaskSession(s), children: s.title
  })
}

function TaskCard({ task, activeZt, onPickRepo, pickedDir, editorName = 'VS Code' }) {
  const sessions = useSessions()
  const chips = (sessions.data?.zt_sessions || {})[task.id] || []
  const profile = host.state.focusedSessionProfile?.get() || host.state.profile?.get() || 'default'
  const preferred = chips.find((s) => (s.profile || 'default') === profile) || chips[0]
  const [choosing, setChoosing] = useState(false)
  const title = preferred?.title || taskPrefix(task.id, sessions.data?.zt_sessions)
  const isActive = activeZt === task.id
  return jsxs('div', {
    className: cn('db-card rounded-lg border bg-transparent', isActive ? 'border-(--accent)' : 'border-(--ui-stroke-secondary)'),
    children: [
      jsxs('div', { className: 'db-card-head db-toolbar border-b border-(--ui-stroke-secondary)', children: [
        jsx('span', { className: 'db-title', title, children: title }),
        jsx(Badge, { variant: 'secondary', children: task.repos.length + ' 仓' }),
        isActive ? jsx(Badge, { variant: 'success', children: '当前会话' }) : null,
        jsxs('div', { className: 'ml-auto flex gap-1', children: [
          preferred ? jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => openTaskSession(preferred), children: '打开会话' }) : null,
          chips.length > 1 ? jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => setChoosing(!choosing), children: '选择会话' }) : null,
          choosing && chips.length > 1 ? jsx(Select, { value: '', onValueChange: (value) => {
            const s = chips.find((s) => JSON.stringify([s.profile || 'default', s.id]) === value)
            if (s) { setChoosing(false); return openTaskSession(s) }
          }, children: [
            jsx(SelectTrigger, { children: jsx(SelectValue, { placeholder: '选择会话' }) }),
            jsx(SelectContent, { children: chips.map((s) => jsx(SelectItem, { value: JSON.stringify([s.profile || 'default', s.id]), children: (s.profile || 'default') + ' · ' + s.title }, JSON.stringify([s.profile || 'default', s.id]))) })
          ] }) : null,
          jsx(Button, {
            variant: 'ghost', size: 'sm',
            onClick: () => openEditor(task.id, editorName),
            children: '在 ' + editorName + ' 打开'
          })
        ]})
      ]}),
      jsx('div', { className: 'db-repos', children: task.repos.map((r) => jsxs('div', {
        className: 'db-repo',
        style: pickedDir === r.dir ? { borderColor: 'var(--ui-accent)' } : undefined,
        children: [
          jsxs('button', { type: 'button', className: 'db-repo-head', onClick: () => onPickRepo(r), 'aria-pressed': pickedDir === r.dir, title: r.dir, children: [
            jsx(StatusDot, { tone: r.dirty > 0 ? 'warn' : 'good' }),
            jsx('span', { className: 'db-repo-name', children: r.repo }),
            r.dirty > 0 ? jsx(Badge, { variant: 'warning', children: r.dirty + ' 未提交' }) : null
          ]}),
          jsx('div', { className: 'db-meta', title: r.branch || '(detached)', children: r.branch || '(detached)' }),
          jsx('div', { className: 'db-meta', title: r.last || '—', children: r.last || '—' }),
          jsx(ReviewLinks, { repo: r, showRepo: false })
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
  if (staleBackend(board.data)) return staleNotice()
  const tasks = board.data?.tasks || []
  const sorted = activeZt ? [...tasks.filter((t) => t.id === activeZt), ...tasks.filter((t) => t.id !== activeZt)] : tasks
  return jsxs(ScrollArea, { className: 'dev-board h-full', children: [
    boardStyle(), jsxs('div', { className: 'flex flex-col gap-2 p-3', children: [
      jsxs('div', { className: 'db-toolbar text-(--ui-text-tertiary) text-xs', children: [
        jsx('span', { children: tasks.length + ' 个任务' + (activeZt ? ' · 当前 ' + taskPrefix(activeZt, sessions.data?.zt_sessions) : '') }),
        jsx(Button, {
          variant: 'secondary', size: 'sm',
          onClick: () => openDock(sessions.data?.zt_sessions || {}),
          children: '在会话右侧打开'
        }),
        jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => board.refetch(), children: '刷新' })
      ]}),
      sorted.map((t) => jsx(TaskCard, { task: t, activeZt, pickedDir, editorName: board.data?.editor_name || 'VS Code', onPickRepo: (r) => setPickedDir(r.dir) }, t.id))
    ]})
  ]})
}

const taskStatus = { todo: '待办', doing: '进行中', done: '已完成' }
const launchedTasks = new Map()
const startingTasks = new Set()

function taskSessionTitle(task) {
  const identity = task.task_id.trim()
  const label = /^[A-Za-z]+-\d{2,6}$/.test(identity) ? identity : /^\d{2,6}$/.test(identity) ? 'ZT-' + identity : 'Task-' + task.id
  return label + ' ' + task.title
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
  const query = useQuery({ queryKey: ['dev-board-tasks'], queryFn: () => rest('/tasks') })
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ title: '', task_id: '', note: '', zentao_url: '' })
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
    setDraft({ title: task?.title || '', task_id: task?.task_id || '', note: task?.note || '', zentao_url: task?.zentao_url || '' })
  }
  const tasks = [...(query.data?.tasks || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order)
    .filter(t => (filter === 'all' || t.status === filter) && [t.title, t.task_id, t.note].join(' ').toLowerCase().includes(search.toLowerCase()))
  const action = (label, onClick, extra = {}) => jsx(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick, children: label, ...extra })
  return jsxs(ScrollArea, { className: 'dev-board h-full', children: [boardStyle(),
    jsxs('div', { className: 'db-tasks', children: [
      jsxs('div', { className: 'db-toolbar', children: [jsx('span', { className: 'db-title', children: '任务清单' }), action('新建任务', () => edit(null)), action('刷新', () => run(() => Promise.resolve()))] }),
      jsxs('div', { className: 'db-toolbar', role: 'tablist', 'aria-label': '任务状态', children: Object.entries({ all: '全部', ...taskStatus }).map(([value, label]) => action(label, () => setFilter(value), { role: 'tab', 'aria-selected': filter === value })) }),
      jsx('input', { type: 'search', value: search, placeholder: '搜索任务', 'aria-label': '搜索任务', onChange: e => setSearch(e.target.value) }),
      error || query.isError ? jsx('div', { role: 'alert', children: error || query.error?.message || '加载失败' }) : null,
      editing ? jsxs('form', { className: 'db-task-form', onSubmit: e => { e.preventDefault(); return run(async () => {
        await rest(editing === 'new' ? '/tasks' : '/tasks/' + editing, { method: editing === 'new' ? 'POST' : 'PATCH', body: draft }); setEditing(null)
      }) }, children: [
        ...[['title', '标题'], ['task_id', '禅道 / 任务 ID（可选）'], ['note', '备注'], ['zentao_url', '禅道链接（可选）']].map(([key, label]) => jsx('input', {
          'aria-label': label, placeholder: label, required: key === 'title', type: key === 'zentao_url' ? 'url' : 'text', value: draft[key], onChange: e => setDraft({ ...draft, [key]: e.target.value }) }, key)),
        jsx(Button, { type: 'submit', size: 'sm', disabled: busy, children: '保存' }), action('取消', () => setEditing(null), { type: 'button' })
      ] }) : null,
      query.isLoading ? jsx('div', { children: '加载任务…' }) : !tasks.length ? jsx(EmptyState, { title: '暂无任务' }) : null,
      jsx('div', { className: 'db-task-columns', children: Object.entries(taskStatus).map(([status, label]) => jsxs('section', {
        className: cn('db-task-zone', dropTarget === status && 'db-drop-target'), 'aria-label': label,
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
        children: [jsx('div', { className: 'db-section', children: label }),
      ...[true, false].map(pinned => jsxs('div', { children: [
        tasks.some(t => t.status === status && t.pinned === pinned) ? jsx('div', { className: 'db-section', children: pinned ? '置顶' : '任务' }) : null,
        ...tasks.filter(t => t.status === status && t.pinned === pinned).map(task => jsxs('div', {
          className: cn('db-task-row', dragging === task.id && 'db-dragging'), draggable: !busy,
          onDragStart: e => {
            if (busyRef.current) { e.preventDefault(); return }
            draggedTask.current = task; setDragging(task.id)
            e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id)
          },
          onDragEnd: () => { draggedTask.current = null; setDragging(null); setDropTarget(null) },
          children: [
          jsxs('div', { className: 'db-toolbar', children: [
            action(taskStatus[task.status], () => run(() => update(task, { status: { todo: 'doing', doing: 'done', done: 'todo' }[task.status] })), { 'aria-label': '切换状态 ' + task.title }),
            jsx('span', { className: 'db-task-title', children: task.title }),
            task.task_id || task.zentao_url ? (task.zentao_url ? action(task.task_id || '禅道', () => run(async () => {
              if (!await openExternal(task.zentao_url)) throw new Error('系统未打开链接')
            })) : jsx(Badge, { className: 'db-task-id', children: task.task_id })) : null
          ] }),
          task.note ? jsx('div', { className: 'db-task-note', children: task.note }) : null,
          jsxs('div', { className: 'db-toolbar', children: [
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
  id: 'dev-board',
  name: 'Dev Board',
  description: 'Cross-repo worktree board linked to the current session, with a chat-side dock panel.',
  register(ctx) {
    const lifetime = { active: true }
    dockLifetime = lifetime
    ctx.onDispose(() => {
      lifetime.active = false
      launchedTasks.clear()
      closeDock?.()
      closeDock = null
    })
    boardFetch = (path, options) => ctx.rest(path, options)
    openExternal = (url) => ctx.os.openExternal(url)
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: '/dev-board' }, render: () => jsx(BoardPage, {}) })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/dev-board', label: 'Dev Board', codicon: 'git-branch' } })
    ctx.register({ id: 'tasks-page', area: ROUTES_AREA, data: { path: '/tasks' }, render: () => jsx(TasksPage, {}) })
    ctx.register({ id: 'tasks-nav', area: SIDEBAR_NAV_AREA, data: { path: '/tasks', label: '任务清单', codicon: 'todo' } })
    ctx.register({ id: 'tasks-open', area: PALETTE_AREA, data: { id: 'dev-board-tasks', label: 'Dev Board：任务清单', run: () => host.navigate('/tasks') } })
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
