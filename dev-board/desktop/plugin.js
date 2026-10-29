/**
 * dev-board — cross-repo worktree board, linked to the current session.
 * Sidebar page: full board. Workspace dock (right of chat): repo tree + unified diff
 * for the FOCUSED session's ZT task — visible while you chat.
 */
import { cn, host, useQuery, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ScrollArea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusDot, Codicon } from '@hermes/plugin-sdk'


function taskPrefix(id, map = {}) {
  const list = map[id] || []
  const profile = host.state.focusedSessionProfile?.get() || host.state.profile?.get() || 'default'
  return (list.find((s) => s.profile === profile) || list[0])?.label || '#' + id
}

const boardStyles = `
.dev-board { --db-control-height:36px; min-width:0; width:100%; max-width:100%; box-sizing:border-box; color:var(--ui-text-primary); font-size:12px; }
.dev-board *, .dev-board *::before, .dev-board *::after { box-sizing:border-box; }
.dev-board button, .dev-board input { max-width:100%; font:inherit; }
.dev-board button { cursor:pointer; }
.dev-board button:focus-visible, .dev-board input:focus-visible, .dev-board summary:focus-visible, .dev-board [tabindex]:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.dev-board button:disabled { cursor:default; opacity:.5; }
.dev-board .db-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-width:0; }
.dev-board .db-title { font-size:14px; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 0; }
.dev-board .db-card { border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-lg); overflow:hidden; }
.dev-board .db-card-head { padding:12px 14px; }
.dev-board .db-card-head > * { min-width:0; max-width:100%; }
.dev-board .db-repos { display:flex; flex-direction:column; gap:10px; padding:12px; }
.dev-board .db-repo { min-width:0; border-radius:var(--radius-md); }
.dev-board .db-repo-head { display:flex; align-items:center; gap:6px; min-width:0; border:0; background:transparent; color:inherit; text-align:left; }
.dev-board .db-repo-name { font-size:13px; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dev-board .db-meta { font-size:12px; color:var(--ui-text-secondary); min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dev-board .db-review { width:100%; min-width:0; font-size:12px; border-top:1px solid var(--ui-stroke-secondary); padding:8px 0 0; margin-top:6px; overflow-wrap:anywhere; }
.dev-board .db-review-head { display:flex; align-items:center; flex-wrap:wrap; gap:4px; color:var(--ui-text-secondary); }
.dev-board .db-review-head > span { flex:1 1 120px; }
.dev-board .db-review-link { display:block; width:100%; border:0; background:transparent; color:var(--ui-accent); text-align:left; padding:5px 0; overflow-wrap:anywhere; }
.dev-board .db-manual, .dev-board form { display:flex; gap:6px; align-items:center; min-width:0; }
.dev-board .db-manual > button:first-child { flex:1; min-width:0; }
.dev-board input { min-width:0; flex:1; padding:5px 6px; border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-sm); color:var(--ui-text-primary); background:transparent; }
.dev-board .db-section { margin:10px 4px 4px; padding:6px 0; border-bottom:1px solid var(--ui-stroke-secondary); color:var(--ui-text-secondary); font-size:12px; font-weight:600; }
.dev-board .db-tree { display:flex; align-items:center; gap:4px; width:100%; min-width:0; border:0; background:transparent; color:inherit; text-align:left; padding-top:4px; padding-bottom:4px; }
.dev-board .db-tree.db-picked, .dev-board .db-tree:hover { background:var(--chrome-action-hover); }
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

.dev-board .db-review-head { flex-wrap:nowrap; gap:6px; }
.dev-board .db-review-head > .db-review-summary { flex:0 1 auto; min-width:0; font-size:11px; color:var(--ui-text-secondary); }
.dev-board .db-review-action { flex-shrink:0; width:28px; height:28px; padding:0; }
.dev-board .db-review-row { display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 8px; color:var(--ui-text-primary); }
.dev-board .db-review-id { color:var(--ui-accent); white-space:nowrap; }
.dev-board .db-review-title { flex:1 1 120px; min-width:0; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.dev-board .db-review-target, .dev-board .db-review-badge { font-size:11px; border-radius:var(--radius-sm); padding:1px 5px; max-width:100%; overflow-wrap:anywhere; background:color-mix(in srgb, var(--ui-text-secondary) 10%, transparent); }
.dev-board .db-review-target, .dev-board .db-review-draft { color:var(--ui-text-secondary); }
.dev-board .db-review-merged { color:var(--ui-green); background:color-mix(in srgb, var(--ui-green) 12%, transparent); }
.dev-board .db-review-open { color:var(--ui-accent); background:color-mix(in srgb, var(--ui-accent) 12%, transparent); }
.dev-board.db-page { container-type:inline-size; }
.dev-board.db-page .db-board-content { display:flex; flex-direction:column; gap:16px; padding:28px; min-width:0; max-width:1440px; margin:auto; }
.dev-board.db-page .db-page-header { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.dev-board.db-page .db-eyebrow { color:var(--ui-accent); letter-spacing:.14em; font-size:10px; font-weight:600; }
.dev-board.db-page .db-page-header h1 { margin:8px 0; font-size:26px; font-weight:650; }
.dev-board.db-page .db-page-header p { margin:0; color:var(--ui-text-secondary); }
.dev-board.db-page .db-board-toolbar { padding:4px 0; gap:10px; }
.dev-board.db-page .db-search { flex:1 1 220px; }
.dev-board.db-page select { font:inherit; max-width:100%; padding:6px; border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-sm); background:transparent; color:var(--ui-text-primary); }
.dev-board.db-page select:focus-visible { outline:2px solid var(--ui-accent); }
.dev-board.db-page .db-board-count { display:flex; flex-wrap:wrap; gap:8px 20px; color:var(--ui-text-secondary); font-size:11px; }
.dev-board.db-page .db-board-count b { color:var(--ui-text-primary); }
.dev-board.db-page .db-board-count .db-accent { color:var(--ui-accent); }
.dev-board.db-page .db-card { background:transparent; }
.dev-board.db-page .db-card-active { border-color:var(--ui-accent); }
.dev-board.db-page .db-card-head { display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding:18px; }
.dev-board.db-page .db-task-toggle { display:flex; align-items:center; gap:10px; flex:1 1 240px; min-width:0; padding:0; text-align:left; border:0; background:transparent; color:inherit; }
.dev-board.db-page .db-task-heading { display:flex; flex-direction:column; flex:1 1 auto; width:100%; gap:6px; min-width:0; }
.dev-board.db-page .db-title { display:block; flex:0 0 auto; width:100%; min-height:1.5em; }
.dev-board.db-page .db-ref { display:inline-block; padding:2px 5px; border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-sm); font:11px monospace; color:var(--ui-text-secondary); }
.dev-board.db-page .db-progress { display:block; width:100px; height:3px; background:var(--ui-stroke-secondary); border-radius:var(--radius-sm); overflow:hidden; }
.dev-board.db-page .db-progress > span { display:block; height:100%; background:var(--ui-accent); }
.dev-board.db-page .db-task-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
.dev-board.db-page .db-task-actions > button:first-child { color:var(--ui-accent); }
.dev-board.db-page .db-pill { display:inline-block; border-radius:var(--radius-md); padding:3px 7px; margin:2px 0; font-size:11px; white-space:nowrap; color:var(--ui-text-tertiary); background:color-mix(in srgb,var(--ui-text-tertiary) 10%,transparent); }
.dev-board.db-page .db-pill-good { color:var(--ui-green); background:color-mix(in srgb,var(--ui-green) 10%,transparent); }
.dev-board.db-page .db-pill-warn, .dev-board.db-page .db-dirty { color:var(--ui-warning, var(--ui-accent)); }
.dev-board.db-page .db-pill-warn { background:color-mix(in srgb,var(--ui-accent) 10%,transparent); }
.dev-board.db-page .db-repo-table { width:100%; table-layout:fixed; border-collapse:collapse; font-size:12px; }
.dev-board.db-page .db-repo-table th { color:var(--ui-text-tertiary); font-weight:500; text-align:left; }
.dev-board.db-page .db-repo-table th, .dev-board.db-page .db-repo-table td { padding:12px 10px; border-top:1px solid var(--ui-stroke-secondary); vertical-align:middle; overflow-wrap:anywhere; }
.dev-board.db-page .db-repo-table th:nth-child(1) { width:19%; }
.dev-board.db-page .db-repo-table th:nth-child(2) { width:43%; }
.dev-board.db-page .db-repo-table th:nth-child(3) { width:12%; }
.dev-board.db-page .db-repo-table th:nth-child(4) { width:12%; }
.dev-board.db-page .db-repo-table th:nth-child(5) { width:10%; }
.dev-board.db-page .db-repo-table th:nth-child(6) { width:4%; }
.dev-board.db-page .db-repo-name, .dev-board.db-page .db-branch, .dev-board.db-page .db-commit { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dev-board.db-page .db-branch, .dev-board.db-page .db-hash, .dev-board.db-page .db-target { font-family:monospace; }
.dev-board.db-page .db-commit { margin-top:5px; color:var(--ui-text-secondary); }
.dev-board.db-page .db-dirty { display:block; margin-top:5px; font-size:11px; }
.dev-board.db-page .db-table-link, .dev-board.db-page .db-row-action { border:0; background:transparent; color:var(--ui-accent); padding:4px 0; }
.dev-board.db-page .db-row-action { width:100%; color:var(--ui-text-secondary); }
.dev-board .db-control, .dev-board.db-page .db-board-toolbar > input, .dev-board.db-page .db-board-toolbar > select, .dev-board.db-page .db-board-toolbar > button, .dev-board.db-page .db-page-header > button { height:var(--db-control-height); min-height:var(--db-control-height); padding:0 12px; border-radius:var(--radius-md); line-height:1.25; }
.dev-board.db-page .db-board-toolbar > button { border:1px solid var(--ui-stroke-secondary); flex-shrink:0; }
.dev-board.db-page .db-board-toolbar > input { background:var(--ui-bg-elevated); }
.dev-board.db-page .db-board-toolbar > select { background:var(--ui-bg-elevated); }
.dev-board.db-page .db-board-toolbar > button[aria-label="刷新"] { width:var(--db-control-height); padding:0; }
.dev-board .db-candidates { display:flex; flex-direction:column; max-height:50vh; overflow:auto; min-width:0; }
.dev-board .db-candidates button { white-space:normal; overflow-wrap:anywhere; height:auto; text-align:left; }
.dev-board.db-dialog input { max-width:100%; min-width:0; }
.dev-board.db-dialog { width:min(560px,92vw); max-width:92vw; }
.dev-board.db-dialog .db-dialog-path { font-family:monospace; overflow-wrap:anywhere; color:var(--ui-text-secondary); }
.dev-board.db-dialog .db-help-copy p { margin:0 0 12px; line-height:1.7; color:var(--ui-text-secondary); }
.dev-board.db-select-menu { width:auto; max-width:min(32rem,92vw); background:var(--ui-bg-elevated); color:var(--ui-text-primary); }
.dev-board.db-select-menu [role="option"] { white-space:normal; overflow-wrap:anywhere; }
.dev-board.db-dock { container-type:inline-size; }
.dev-board.db-dock .db-dock-header { display:flex; align-items:center; flex-shrink:0; gap:8px; padding:12px; border-bottom:1px solid var(--ui-stroke-secondary); letter-spacing:.12em; font-size:10px; }
.dev-board.db-dock .db-worktree-icon { color:var(--ui-accent); background:color-mix(in srgb,var(--ui-accent) 12%,transparent); border-radius:var(--radius-sm); display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; }
.dev-board.db-dock .db-help { margin-left:auto; width:var(--db-control-height); height:var(--db-control-height); padding:0; }
.dev-board.db-dock .db-task-selector { padding:12px 12px 0; }
.dev-board.db-dock .db-dock-context { padding:16px 12px; }
.dev-board.db-dock .db-context-label { font:10px monospace; color:var(--ui-text-tertiary); }
.dev-board.db-dock .db-context-title { font-size:18px; font-weight:600; line-height:1.45; margin:6px 0; overflow-wrap:anywhere; }
.dev-board.db-dock .db-dock-toolbar { border-top:1px solid var(--ui-stroke-secondary); border-bottom:0; flex-wrap:nowrap; padding:10px 12px; }
.dev-board.db-dock .db-dock-toolbar > button[role="combobox"] { flex:0 1 60%; width:auto; }
.dev-board.db-dock .db-dock-content { display:flex; flex-direction:column; gap:10px; padding:0 10px 12px; }
.dev-board.db-dock .db-dock-repo { border:1px solid var(--ui-stroke-secondary); border-radius:var(--radius-lg); background:color-mix(in srgb,var(--ui-bg-elevated) 50%,transparent); overflow:hidden; }
.dev-board.db-dock .db-dock-repo > summary { display:flex; gap:8px; align-items:center; padding:12px 10px; cursor:pointer; list-style:none; }
.dev-board.db-dock .db-dock-repo > summary::-webkit-details-marker { display:none; }
.dev-board.db-dock .db-dock-repo > summary::before { content:'›'; color:var(--ui-text-tertiary); }
.dev-board.db-dock .db-dock-repo[open] > summary::before { content:'⌄'; }
.dev-board.db-dock .db-dock-repo > summary strong { flex:1; min-width:0; overflow-wrap:anywhere; }
.dev-board.db-dock .db-dock-repo > summary .db-meta { flex-shrink:0; font-size:10px; }
.dev-board.db-dock .db-repo-body { padding:0 12px 12px 20px; }
.dev-board.db-dock .db-dock-branch { font:10px/1.6 monospace; color:var(--ui-text-secondary); overflow-wrap:anywhere; }
.dev-board.db-dock .db-review { border:0; padding:0; margin:0; }
.dev-board.db-dock .db-review-head { display:flex; flex-wrap:wrap; }
.dev-board.db-dock .db-review-status { flex:1; font-size:10px; }
.dev-board.db-dock .db-dock-footer { flex-shrink:0; padding:14px 12px; border-top:1px solid var(--ui-stroke-secondary); }
.dev-board .db-progress { display:block; height:4px; background:var(--ui-stroke-secondary); border-radius:var(--radius-sm); overflow:hidden; }
.dev-board .db-progress > span { display:block; height:100%; background:var(--ui-accent); }
.dev-board.db-dock .db-dock-footer .db-progress { margin:10px 0; }
.dev-board.db-dock .db-dock-footer .db-meta { white-space:normal; font-size:10px; }
.dev-board.db-dock .db-progress-label { color:var(--ui-text-secondary); font-size:11px; }
.dev-board.db-dock .db-footer-actions { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-top:12px; }
.dev-board.db-dock .db-footer-actions > button { height:var(--db-control-height); border-radius:var(--radius-md); }
@container (max-width:300px) {
  .dev-board.db-dock .db-dock-toolbar { flex-wrap:wrap; }
  .dev-board.db-dock .db-dock-toolbar > button[role="combobox"] { flex-basis:100%; }
  .dev-board.db-dock .db-dock-repo > summary { flex-wrap:wrap; }
}
@container (max-width:650px) {
  .dev-board.db-page .db-board-content { padding:12px; }
  .dev-board.db-page .db-page-header { align-items:flex-start; flex-wrap:wrap; }
  .dev-board.db-page .db-card-head { padding:12px; }
  .dev-board.db-page .db-repo-table, .dev-board.db-page .db-repo-table tbody, .dev-board.db-page .db-repo-table tr, .dev-board.db-page .db-repo-table td { display:block; width:100%; }
  .dev-board.db-page .db-repo-table thead { display:none; }
  .dev-board.db-page .db-repo-table tbody { border-top:1px solid var(--ui-stroke-secondary); padding:8px 12px; }
  .dev-board.db-page .db-repo-table td { border:0; padding:5px 0; }
  .dev-board.db-page .db-repo-table td[data-label]::before { content:attr(data-label); display:block; font-size:10px; color:var(--ui-text-tertiary); margin-bottom:3px; }
  .dev-board.db-page .db-row-action { text-align:left; }
}


.dev-board.db-dock { display:flex; flex-direction:column; height:100%; min-height:0; }
.dev-board.db-dock > .db-dock-body { display:flex; flex:1; flex-direction:column; min-height:0; }
.dev-board.db-dock .db-task-selector { flex-shrink:0; }
.dev-board.db-dock .db-dock-context { flex-shrink:0; padding:10px 12px; }
.dev-board.db-dock .db-context-title { font-size:14px; margin:4px 0; }
.dev-board .db-workspace { display:flex; flex:1; min-height:0; min-width:0; overflow:hidden; }
.dev-board .db-files-pane { display:flex; flex-direction:column; width:300px; flex-shrink:0; min-height:0; border-right:1px solid var(--ui-stroke-secondary); }
.dev-board .db-file-search { padding:0 12px 10px; }
.dev-board .db-file-search input { width:100%; }
.dev-board .db-file-scroll { flex:1; min-height:0; overflow:auto; }
.dev-board .db-diff-pane { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; overflow:hidden; }
.dev-board .db-diff-heading, .dev-board .db-diff-tools { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:8px; border-bottom:1px solid var(--ui-stroke-secondary); flex-shrink:0; }
.dev-board .db-diff-heading strong { flex:1; min-width:80px; overflow-wrap:anywhere; }
.dev-board .db-diff-back { display:none; }
.dev-board .db-diff-tools label { margin-left:auto; display:flex; align-items:center; }
.dev-board .db-diff-tools input { flex:none; }
.dev-board .db-diff-tools button[aria-pressed="true"] { background:var(--chrome-action-hover); color:var(--ui-accent); }
.dev-board .db-code-scroll { flex:1; min-height:0; overflow:auto; font:11px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace; }
.dev-board .db-raw-diff { margin:0; padding:12px; white-space:pre-wrap; overflow-wrap:anywhere; }
.dev-board .db-unified { min-width:max-content; }
.dev-board .db-split { min-width:720px; }
.dev-board .db-split-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
.dev-board .db-split-row > :last-child { border-left:1px solid var(--ui-stroke-secondary); }
.dev-board .db-code-line { display:flex; min-width:0; min-height:1.7em; white-space:pre; }
.dev-board .db-line-no { width:45px; flex-shrink:0; padding-right:8px; text-align:right; user-select:none; color:var(--ui-text-tertiary); }
.dev-board .db-line-sign { width:18px; flex-shrink:0; user-select:none; }
.dev-board .db-source { padding-right:10px; }
.dev-board .db-code-add { background:color-mix(in srgb,var(--ui-green) 12%,transparent); }
.dev-board .db-code-del { background:color-mix(in srgb,var(--ui-red) 12%,transparent); }
.dev-board .db-hunk { padding:4px 8px; white-space:pre-wrap; color:var(--ui-accent); background:var(--chrome-action-hover); }
.dev-board .db-wrap .db-unified, .dev-board .db-wrap .db-split { min-width:0; }
.dev-board .db-wrap .db-source { white-space:pre-wrap; overflow-wrap:anywhere; min-width:0; }
.dev-board .db-code-scroll:not(.db-wrap) .db-split { width:max-content; min-width:100%; }
.dev-board .db-code-scroll:not(.db-wrap) .db-split-row { grid-template-columns:minmax(350px,1fr) minmax(350px,1fr); }
.dev-board .db-list-only .db-files-pane { width:100%; border:0; }
.dev-board .db-list-only .db-diff-pane { display:none; }
.dev-board.db-dialog:has(.db-expanded-diff) { width:92vw; max-width:92vw; }
.dev-board .db-expanded-diff { display:flex; height:70vh; min-height:0; }
@container (max-width:650px) {
  .dev-board .db-workspace .db-files-pane { width:100%; border:0; }
  .dev-board .db-workspace .db-diff-pane { display:none; }
  .dev-board .db-workspace.db-has-selection:not(.db-list-only) .db-files-pane { display:none; }
  .dev-board .db-workspace.db-has-selection:not(.db-list-only) .db-diff-pane { display:flex; }
  .dev-board .db-diff-back { display:inline-flex; }
}

`
const boardStyle = () => jsx('style', { children: boardStyles })

const API_VERSION = 4
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

function ReviewLinks({ repo, showRepo = true, compact = false, repoHeader, metadata }) {
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
        repoHeader || null,
        compact && showRepo ? jsx('span', { className: 'db-review-name', title: repo.repo, children: repo.repo }) : null,
        jsx('span', { className: compact ? 'db-review-status' : 'db-review-summary', children: (!compact && showRepo ? repo.repo + ' · ' : '') + (query.isLoading ? '加载中…' : query.isError ? '请求失败' :
          ((compact ? ['ok', 'empty'].includes(data?.status) : ['ok', 'empty'].includes(data?.status) || reviews.length + manual.length) ? (reviews.length + manual.length) + ' · ' : '') + (status[data?.status] || '等待加载')) }),
        jsx(Button, { variant: 'ghost', size: 'sm', className: 'db-review-action',
          title: '刷新 ' + repo.repo + ' 审阅', 'aria-label': '刷新 ' + repo.repo + ' 审阅',
          disabled: query.isFetching, onClick: query.refresh, children: '↻' }),
        jsx(Button, { variant: 'ghost', size: 'sm', className: 'db-review-action',
          title: '为 ' + repo.repo + ' 添加链接', 'aria-label': '为 ' + repo.repo + ' 添加链接',
          disabled: needsBranch, onClick: () => setAdding(!adding), children: '+' })
      ]}),
      metadata || null,
      query.isError ? jsx('div', { role: 'alert', children: query.error?.message || '审阅请求失败' }) : null,
      data?.message && !['ok', 'empty', 'unsupported', 'unavailable', 'timeout', 'partial'].includes(data.status) ? jsx('div', { children: message }) : null,
      ...reviews.map((r) => jsxs('button', { type: 'button', className: 'db-review-link db-review-row',
        title: r.title, onClick: () => openReview(r.url), children: [
          jsx('strong', { className: 'db-review-id', children: (r.provider === 'gitlab' ? 'MR !' : 'PR #') + r.number }),
          jsx('span', { className: 'db-review-title', title: r.title, children: r.title }),
          jsx('span', { className: 'db-review-target', title: r.target_branch, children: '→ ' + r.target_branch }),
          jsx('span', { className: 'db-review-badge db-review-' + (r.state === 'merged' ? 'merged' : r.draft ? 'draft' : ['open', 'opened'].includes(r.state) ? 'open' : 'draft'),
            children: ({ merged: '已合并', open: '待合并', opened: '待合并', closed: '已关闭' }[r.state] || r.state) }),
          r.draft ? jsx('span', { className: 'db-review-badge db-review-draft', children: '草稿' }) : null
        ] }, r.provider + ':' + r.number)),
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
  return useQuery({ queryKey: ['dev-board'], queryFn: async () => { const data = await rest('/board?include_hidden=true'); return { ...data, hidden_repos: data.tasks.flatMap(t => t.repos.filter(r => r.hidden)), tasks: data.tasks.map(t => ({ ...t, repos: t.repos.filter(r => !r.hidden) })).filter(t => t.repos.length) } }, refetchInterval: REFRESH_MS })
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
    if (active) await host.openSession(active.session.id, { profile: active.session.profile || 'default', keepAllProfilesScope: false })
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
    'aria-pressed': pickedKey === row.key,
    className: 'db-tree ' + common + (pickedKey === row.key ? ' db-picked' : ''),
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
  let oldNo = 0, newNo = 0, inHunk = false, oldBuf = [], newBuf = []
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
      if (m) { oldNo = +m[1]; newNo = +m[2]; inHunk = true }
      rows.push({ hunk: l })
      continue
    }
    if (l.startsWith('diff --git')) { flush(); inHunk = false }
    if (inHunk && l.startsWith('\\ No newline')) { flush(); rows.push({ note: l }); continue }
    if (!inHunk || ![' ', '+', '-'].includes(l[0])) continue
    if (l.startsWith('-')) oldBuf.push({ no: oldNo++, text: l.slice(1) })
    else if (l.startsWith('+')) newBuf.push({ no: newNo++, text: l.slice(1) })
    else { flush(); rows.push({ o: { no: oldNo++, text: l.slice(1) }, n: { no: newNo++, text: l.slice(1) }, kind: 'ctx' }) }
  }
  flush()
  return rows
}

function FileCompare({ diff, mode = 'split', wrap = true }) {
  const rows = buildSideBySide(diff)
  if (!rows.length) return jsx('pre', { className: 'db-code-scroll db-raw-diff', children: diff })
  const line = (value, kind, side, key, numbers) => jsxs('div', { className: 'db-code-line db-code-' + (value ? kind : 'ctx'), children: [
    ...(numbers ? numbers.map(no => jsx('span', { className: 'db-line-no', children: no })) : [jsx('span', { className: 'db-line-no', children: value?.no })]),
    jsx('span', { className: 'db-line-sign', children: !value || kind === 'ctx' ? ' ' : side === 'o' ? '−' : '+' }),
    jsx('span', { className: 'db-source', children: value?.text || ' ' })
  ] }, key)
  const hunk = (row, key) => jsx('div', { className: 'db-hunk', children: row.hunk }, key)
  const unified = []
  let changes = []
  const flush = () => {
    for (const side of ['o', 'n']) for (const row of changes) if (row[side]) unified.push(line(row[side], side === 'o' ? 'del' : 'add', side, unified.length, [side === 'o' ? row.o.no : undefined, side === 'n' ? row.n.no : undefined]))
    changes = []
  }
  for (const row of rows) {
    if (!row.hunk && !row.note && row.kind !== 'ctx') { changes.push(row); continue }
    flush()
    unified.push(row.note ? jsx('div', { className: 'db-hunk', children: row.note }, unified.length) : row.hunk ? hunk(row, unified.length) : line(row.n, 'ctx', 'n', unified.length, [row.o.no, row.n.no]))
  }
  flush()
  return jsx('div', { className: 'db-code-scroll' + (wrap ? ' db-wrap' : ''), children: mode === 'unified'
    ? jsx('div', { className: 'db-unified', children: unified })
    : jsx('div', { className: 'db-split', children: rows.map((row, i) => row.note ? jsx('div', { className: 'db-hunk', children: row.note }, i) : row.hunk
      ? hunk(row, i)
      : jsxs('div', { className: 'db-split-row', children: [line(row.o, row.kind === 'ctx' ? 'ctx' : 'del', 'o'), line(row.n, row.kind === 'ctx' ? 'ctx' : 'add', 'n')] }, i)) }) })
}

function taskIdentity(id, map = {}) {
  const profile = host.state.focusedSessionProfile?.get() || host.state.profile?.get() || 'default'
  const list = map[id] || []
  const title = (list.find(s => (s.profile || 'default') === profile) || list[0])?.title
  const label = taskPrefix(id, map)
  return title ? (title.includes(label) ? title : label + ' · ' + title) : label
}

function workspaceDialog({ open, onOpenChange, title, description, children, returnFocus, footer }) {
  return jsx(Dialog, { open, onOpenChange, children: jsxs(DialogContent, {
    className: 'dev-board db-dialog',
    onCloseAutoFocus: returnFocus ? event => { event.preventDefault(); returnFocus.current?.focus() } : undefined,
    children: [
      boardStyle(),
      jsxs(DialogHeader, { children: [jsx(DialogTitle, { children: title }), jsx(DialogDescription, { children: description })] }),
      children,
      jsx(DialogFooter, { children: footer || jsx(Button, { variant: 'secondary', onClick: () => onOpenChange(false), children: '关闭' }) })
    ]
  }) })
}

function dockTreeRows(files, expanded, repoKey) {
  const tree = buildTree(files.map(f => ({ ...f, originalPath: f.path })))
  const rows = []
  const walk = (node, depth, prefix) => {
    for (const child of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const key = prefix + child.name + '/'
      rows.push({ type: 'dir', key, name: child.name, depth, ...tree.countAll(child) })
      if (expanded.has(key)) walk(child, depth + 1, key)
    }
    for (const f of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ ...f, type: 'file', key: repoKey + ':' + f.originalPath, path: f.originalPath, depth })
    }
  }
  walk(tree.root, 0, repoKey + ':')
  return rows
}

function DockPanel() {
  const board = useBoard()
  const sessions = useActiveZt()
  const [selectedTask, setSelectedTask] = useState('auto')
  const activeZt = selectedTask === 'auto' ? sessions.active?.id : selectedTask
  const [repoFilter, setRepoFilter] = useState('all')
  const [expanded, setExpanded] = useState(() => new Set())
  const [picked, setPicked] = useState(null) // {dir, path, repo}
  const [search, setSearch] = useState('')
  const [collapsedRepos, setCollapsedRepos] = useState(() => new Set())
  const [mode, setMode] = useState('unified')
  const [wrap, setWrap] = useState(false)
  const [enlarged, setEnlarged] = useState(false)
  const expandTrigger = useRef(null)
  const workspaceRef = useRef(null)
  const task = (board.data?.tasks || []).find((t) => t.id === activeZt)
  const tc = useQuery({
    queryKey: ['dev-board-task-changes', activeZt],
    queryFn: () => rest('/task_changes?task=' + encodeURIComponent(activeZt || '')),
    enabled: !!activeZt
  })
  const fileDiff = useDiff(picked?.dir, picked?.path)
  useEffect(() => {
    if (picked && !task?.repos.some(repo => repo.dir === picked.dir)) { setPicked(null); setEnlarged(false) }
    if (repoFilter !== 'all' && !task?.repos.some(repo => repo.dir === repoFilter)) setRepoFilter('all')
    tc.refetch?.()
  }, [board.data])
  useEffect(() => { setExpanded(new Set()); setPicked(null); setRepoFilter('all'); setSearch(''); setCollapsedRepos(new Set()); setEnlarged(false) }, [activeZt])
  const [help, setHelp] = useState(false)
  const helpTrigger = useRef(null)
  const [reviewData, setReviewData] = useState({})
  const onData = useMemo(() => (dir, branch, data, error) => setReviewData(prev => ({ ...prev, [dir]: { branch, data, error } })), [])
  const taskTitle = taskIdentity(activeZt, sessions.data?.zt_sessions)
  const taskSelector = jsx('div', { className: 'db-task-selector', children: jsx(Select, {
    value: selectedTask, onValueChange: setSelectedTask,
    children: [
      jsx(SelectTrigger, { className: 'db-control w-full', 'aria-label': '切换当前任务', children: jsx(SelectValue, { placeholder: '选择任务' }) }),
      jsx(SelectContent, { className: 'dev-board db-select-menu', children: [
        jsx(SelectItem, { value: 'auto', children: '跟随当前会话' }),
        ...(board.data?.tasks || []).map((t) => jsx(SelectItem, { value: t.id, title: taskIdentity(t.id, sessions.data?.zt_sessions), children: taskIdentity(t.id, sessions.data?.zt_sessions) }, t.id))
      ]})
    ]
  }) })
  const panel = (content) => jsxs('div', { className: 'dev-board db-dock h-full flex flex-col min-h-0', children: [
    boardStyle(),
    jsxs('header', { className: 'db-dock-header', children: [
      jsx('span', { className: 'db-worktree-icon', 'aria-hidden': true, children: jsx(Codicon, { name: 'git-branch', size: 16 }) }),
      jsx('strong', { children: 'WORKTREE' }),
      jsx(Button, { variant: 'ghost', size: 'sm', className: 'db-help', 'aria-label': '查看 Worktree 使用说明', ref: helpTrigger, onClick: () => setHelp(true), children: 'ⓘ' })
    ] }),
    taskSelector,
    help ? workspaceDialog({ open: help, onOpenChange: setHelp, returnFocus: helpTrigger, title: 'Worktree 使用说明', description: '在会话旁查看任务的仓库、文件变更与代码审阅。', children: jsxs('div', { className: 'db-help-copy', children: [
      jsx('p', { children: '默认跟随当前会话；也可以通过任务选择器固定查看其他任务。切换任务会重置仓库筛选和文件选择。' }),
      jsx('p', { children: '展开仓库查看分支、文件树及 PR/MR。点击文件可对比差异；审阅链接通过系统浏览器打开，支持手工添加和移除链接。' }),
      jsx('p', { children: '合并进度来自代码审阅查询。未配置、查询失败或手工链接状态未知时，进度会明确标记为未知。' })
    ] }) }) : null,
    content
  ] })
  const taskContext = count => jsxs('section', { className: 'db-dock-context', children: [
    jsx('div', { className: 'db-context-label', children: (selectedTask === 'auto' ? '跟随会话' : '当前选中') + ' · ' + taskPrefix(task.id, sessions.data?.zt_sessions) }),
    jsx('h2', { className: 'db-context-title', title: taskTitle, children: taskTitle }),
    jsx('div', { className: 'db-meta', children: count + ' 个关联仓库' })
  ] })
  const state = (title, description) => panel(jsxs('div', { className: 'db-dock-body', children: [task ? taskContext(task.repos.length) : null, jsx(EmptyState, { title, description })] }))
  if (board.isLoading || (selectedTask === 'auto' && sessions.isLoading)) return state('加载任务和会话…')
  if (board.isError) return state('任务加载失败', board.error?.message)
  if (staleBackend(board.data)) return panel(staleNotice())
  if (selectedTask === 'auto' && sessions.isError) return state('会话映射加载失败', (sessions.error?.message || '') + '；可手动选择任务')
  if (!activeZt) return state('当前会话未匹配任务', '请从上方手动选择任务，或打开含任务编号的会话')
  if (!task) return state(taskPrefix(activeZt, sessions.data?.zt_sessions) + ' 无活跃 worktree', '可从上方选择其他任务')
  if (tc.isLoading || (!tc.data && !tc.isError)) return state('加载任务变更…')
  if (tc.isError) return state('任务变更加载失败', tc.error?.message)
  const allFiles = (tc.data?.files || []).filter(file => task.repos.some(repo => repo.dir === file.dir))
  const repositories = [...new Map([
    ...task.repos.map(repo => [repo.dir, repo]),
    ...(tc.data?.repos || []).filter(repo => task.repos.some(r => r.dir === repo.dir)).map(repo => [repo.dir, { ...task.repos.find(r => r.dir === repo.dir), ...repo }]),
    ...allFiles.filter(file => !task.repos.some(r => r.dir === file.dir) && !(tc.data?.repos || []).some(r => r.dir === file.dir)).map(file => [file.dir, { repo: file.repo, dir: file.dir }])
  ]).values()]
  const filteredFiles = allFiles.filter(file => (repoFilter === 'all' || file.dir === repoFilter) && file.path.toLowerCase().includes(search.toLowerCase()))
  const visibleRepos = repositories.filter(repo => (repoFilter === 'all' || repo.dir === repoFilter) && (!search || filteredFiles.some(file => file.dir === repo.dir)))
  const position = filteredFiles.findIndex(file => file.dir === picked?.dir && file.path === picked?.path)
  const pick = file => { if (!enlarged) workspaceRef.current?.focus({ preventScroll: true }); setPicked(file) }
  const step = direction => {
    const next = position < 0 ? (direction > 0 ? 0 : filteredFiles.length - 1) : position + direction
    if (filteredFiles[next]) pick(filteredFiles[next])
  }
  const onKeyDown = event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); step(event.key === 'ArrowUp' ? -1 : 1)
    }
  }
  const compare = () => fileDiff.isError ? jsx(EmptyState, { title: '文件差异加载失败', description: fileDiff.error?.message })
    : fileDiff.isLoading || !fileDiff.data ? jsx(EmptyState, { title: '加载文件差异…' })
    : fileDiff.data.diff ? jsx(FileCompare, { diff: fileDiff.data.diff, mode, wrap }, picked.dir + ':' + picked.path)
    : jsx(EmptyState, { title: '此文件无可显示的差异' })
  const diffPane = (dialog = false) => jsxs('section', { className: 'db-diff-pane', 'aria-label': '文件差异', children: picked ? [
    jsxs('div', { className: 'db-diff-heading', children: [
      jsx(Button, { className: 'db-diff-back', variant: 'ghost', size: 'sm', onClick: () => { if (dialog) setEnlarged(false); else { workspaceRef.current?.focus({ preventScroll: true }); setPicked(null) } }, children: '← 返回' }),
      jsx('strong', { title: picked.dir + ' / ' + picked.path, children: picked.repo + ' · ' + picked.path }),
      jsx('span', { className: 'db-meta', children: position < 0 ? '当前文件不在筛选中' : (position + 1) + ' / ' + filteredFiles.length }),
      jsx(Button, { variant: 'ghost', size: 'sm', 'aria-label': '上一文件', disabled: !filteredFiles.length || position === 0, onClick: () => step(-1), children: '↑' }),
      jsx(Button, { variant: 'ghost', size: 'sm', 'aria-label': '下一文件', disabled: !filteredFiles.length || position === filteredFiles.length - 1, onClick: () => step(1), children: '↓' }),
      !dialog ? jsx(Button, { variant: 'ghost', size: 'sm', ref: expandTrigger, 'aria-label': '放大查看', onClick: () => setEnlarged(true), children: '⤢' }) : null
    ] }),
    jsxs('div', { className: 'db-diff-tools', children: [
      ...[['unified', '统一'], ['split', '并排']].map(([value, label]) => jsx(Button, { variant: 'ghost', size: 'sm', 'aria-pressed': mode === value, onClick: () => setMode(value), children: label }, value)),
      jsxs('label', { children: [jsx('input', { type: 'checkbox', checked: wrap, onChange: event => setWrap(event.target.checked) }), ' 自动换行'] }),
      jsx('span', { className: 'db-meta', children: 'Alt + ↑ / ↓' })
    ] }),
    enlarged && !dialog ? null : compare()
  ] : jsx(EmptyState, { title: '选择文件查看差异' }) })
  const summary = taskReviewSummary(task, reviewData)
  const progress = summary.known ? (summary.reviews.length ? summary.merged + ' / ' + summary.reviews.length + ' 个审阅已合并' : '无关联审阅') : '合并进度未知'
  const context = taskContext(repositories.length)
  const observers = task.repos.map(repo => jsx(BoardReviewObserver, { repo, onData }, repo.dir))
  return panel(jsxs('div', { className: 'db-dock-body', children: [
    ...observers,
    context,
    jsxs('div', { className: 'db-workspace' + (picked ? ' db-has-selection' : ''), ref: workspaceRef, tabIndex: 0, onKeyDown, children: [
      jsxs('section', { className: 'db-files-pane', 'aria-label': '变更文件列表', children: [
        jsxs('div', { className: 'db-dock-toolbar', children: [
          jsx('strong', { className: 'db-title', children: '变更文件' + (allFiles.length ? ' · ' + filteredFiles.length + ' / ' + allFiles.length : '') }),
          jsx(Select, { value: repoFilter, onValueChange: setRepoFilter, children: [
            jsx(SelectTrigger, { className: 'db-control', 'aria-label': '筛选仓库', children: jsx(SelectValue, {}) }),
            jsx(SelectContent, { className: 'dev-board db-select-menu', children: [
              jsx(SelectItem, { value: 'all', children: '全部仓库' }),
              ...repositories.map(repo => jsx(SelectItem, { value: repo.dir, title: repo.dir, children: repo.repo }, repo.dir))
            ] })
          ] })
        ] }),
        jsx('div', { className: 'db-file-search', children: jsx('input', { type: 'search', 'aria-label': '搜索文件或路径', placeholder: '搜索文件或路径…', value: search, onChange: event => setSearch(event.target.value) }) }),
        jsx(ScrollArea, { className: 'db-file-scroll', children: jsxs('div', { className: 'db-dock-content', children: [
          ...visibleRepos.map(repo => {
            const files = filteredFiles.filter(file => file.dir === repo.dir)
            const rows = search ? files.map(file => ({ ...file, name: file.path, type: 'file', depth: 0, key: file.dir + ':' + file.path })) : dockTreeRows(files, expanded, repo.dir)
            return jsxs('details', { className: 'db-dock-repo', open: !collapsedRepos.has(repo.dir), onToggle: event => { const open = event.currentTarget.open; setCollapsedRepos(previous => { if (previous.has(repo.dir) === !open) return previous; const next = new Set(previous); open ? next.delete(repo.dir) : next.add(repo.dir); return next }) }, children: [
              jsxs('summary', { title: repo.dir, children: [jsx('strong', { children: repo.repo }), jsx('span', { className: 'db-meta', children: files.length ? files.length + ' 文件' : search ? '无匹配文件' : '无未提交变更' })] }),
              jsxs('div', { className: 'db-repo-body', children: [
                jsxs('div', { className: 'db-dock-branch', title: repo.branch || '(detached)', children: [jsx(Codicon, { name: 'git-branch', size: 12 }), ' ', repo.branch || '(detached)'] }),
                jsx('h3', { className: 'db-section', children: '文件变更' }),
                ...rows.map(row => jsx(TreeRow, {
                  row, expanded, onToggle: () => setExpanded(previous => { const next = new Set(previous); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next }),
                  onPick: () => pick({ dir: row.dir, path: row.path, repo: row.repo }), pickedKey: picked ? picked.dir + ':' + picked.path : null
                }, row.key)),
                jsx('h3', { className: 'db-section', children: 'PR/MR' }),
                jsx(WorktreeActions, { repo }), jsx(ReviewLinks, { repo, compact: true, showRepo: false })
              ] })
            ] }, task.id + ':' + repo.dir)
          }),
          !visibleRepos.length ? jsx('div', { className: 'db-clean', children: repositories.length ? '没有匹配的文件或仓库' : '无未提交变更 · 当前任务没有关联仓库' }) : null
        ] }) })
      ] }),
      diffPane()
    ] }),
    enlarged && picked ? workspaceDialog({ open: true, onOpenChange: setEnlarged, returnFocus: expandTrigger, title: picked.repo + ' · ' + picked.path, description: '文件差异', children: jsx('div', { className: 'db-expanded-diff', tabIndex: 0, onKeyDown, children: diffPane(true) }) }) : null,
    jsxs('footer', { className: 'db-dock-footer', children: [
      jsx('div', { className: 'db-progress-label', children: progress }),
      summary.known && summary.reviews.length ? jsx('div', { className: 'db-progress', role: 'progressbar', 'aria-label': '审阅合并进度', 'aria-valuemin': 0, 'aria-valuemax': summary.reviews.length, 'aria-valuenow': summary.merged, children: jsx('span', { style: { width: summary.merged / summary.reviews.length * 100 + '%' } }) }) : null,
      !summary.known ? jsx('p', { className: 'db-meta', children: '等待完整审阅结果；手工链接不提供合并状态。' }) : null,
      jsxs('div', { className: 'db-footer-actions', children: [
        jsx(Button, { variant: 'secondary', size: 'sm', onClick: () => openEditor(task.id, board.data?.editor_name || 'VS Code'), children: '在 ' + (board.data?.editor_name || 'VS Code') + ' 打开' }),
        jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => host.navigate('/dev-board'), children: '仓库视图 →' })
      ] })
    ] })
  ] }))
}

// ─── Sidebar board page (full board, as before + dock opener) ────────────────
async function openTaskSession(s) {
  try { await host.openSession(s.id, { profile: s.profile || 'default', keepAllProfilesScope: false }) }
  catch (error) { host.notify({ kind: 'error', message: '打开会话失败：' + (error.message || String(error)) }) }
}

function SessionChip({ s }) {
  return jsx('button', {
    className: 'rounded-full border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover) truncate max-w-[14rem]',
    title: s.title, onClick: () => openTaskSession(s), children: s.title
  })
}

function BoardReviewObserver({ repo, onData }) {
  const query = useReviews(repo.dir, repo.branch)
  useEffect(() => { onData(repo.dir, repo.branch, query.data, query.isError) }, [repo.dir, repo.branch, query.data, query.isError, onData])
  return null
}

function taskReviewSummary(task, reviewData = {}) {
  const entries = task.repos.map(r => reviewData[r.dir]?.branch === r.branch ? reviewData[r.dir] : null)
  const reviews = entries.flatMap(e => e?.data?.reviews || [])
  const known = entries.length > 0 && entries.every(e => e && !e.error && ['ok', 'empty'].includes(e.data?.status) && !(e.data?.manual || []).length)
  const merged = reviews.filter(r => r.state === 'merged').length
  const failed = entries.some(e => e?.error || ['error', 'timeout', 'partial'].includes(e?.data?.status))
  const open = reviews.some(r => ['open', 'opened', 'failed'].includes(r.state))
  return { known, reviews, merged, pending: reviews.length - merged,
    done: known && reviews.length > 0 && merged === reviews.length,
    needs: open || failed,
    waiting: reviews.some(r => r.state !== 'merged') || failed || (!known && task.repos.some(r => r.dirty > 0)) }
}

const startingSessions = new Set()
const emptySession = s => s?.message_count === 0 && Array.isArray(s.messages) && !s.messages.length && s.running === false && Array.isArray(s.pending) && !s.pending.length && Array.isArray(s.prompts) && !s.prompts.length
const analysisPrompt = task => `任务编号：#${task.id}
${task.repos.map(r => `仓库：${r.repo}\n分支：${r.branch}\nWorktree：${r.dir}`).join('\n\n')}

FIRST ANALYZE ONLY：先读取任务与仓库规范，分析需求、影响范围和待确认项，给出方案。本轮禁止修改代码。`

async function createTaskSession(task, refresh) {
  if (startingSessions.has(task.id)) return
  startingSessions.add(task.id)
  let saved = false
  let attempted = false
  try {
    const profile = host.state.profile.get() || 'default'
    const update = async (action, extra = {}) => {
      const result = await rest('/task_session', { method: 'POST', body: { task: task.id, action, ...extra } })
      if (!result?.ok || !result.link) throw new Error(result?.detail || '保存会话关联失败')
      return result
    }
    let { link } = await update('claim', { profile })
    if (profile !== link.profile) throw new Error('请切换到 ' + link.profile + ' 后重试')
    if (!link.id) {
      const created = await host.request('session.create', { title: link.title, profile: link.profile, request_id: link.title })
      if (!created?.stored_session_id) throw new Error('网关未返回 stored session ID；重试将使用同一创建标题')
      ;({ link } = await update('link', { id: created.stored_session_id, profile: link.profile }))
    }
    saved = true
    await host.openSession(link.id, { profile: link.profile, keepAllProfilesScope: false })
    if (link.prompt_state !== 'pending') return
    if (host.state.profile.get() !== link.profile) throw new Error('请切换到会话所属 profile 后重试')
    const snapshot = await host.request('session.resume', { session_id: link.id, profile: link.profile })
    if (!emptySession(snapshot)) throw new Error('会话非空或状态不明，未发送分析提示')
    const draft = await host.composer.getDraft(link.id)
    if (draft !== '' || host.state.profile.get() !== link.profile) throw new Error('草稿非空、界面未就绪或 profile 已切换，未发送分析提示')
    attempted = true
    await update('dispatch', { id: link.id, profile: link.profile })
    const finalSnapshot = await host.request('session.resume', { session_id: link.id, profile: link.profile })
    const finalDraft = await host.composer.getDraft(link.id)
    if (!emptySession(finalSnapshot) || finalDraft !== '' || host.state.profile.get() !== link.profile) {
      await update('rejected', { id: link.id, profile: link.profile })
      attempted = false
      throw new Error('会话、草稿或 profile 已变化，未发送分析提示，可重试')
    }
    // An ambiguous submit failure stays attempting: never automatically send twice.
    if (!host.composer.submit(link.id, analysisPrompt(task))) {
      await update('rejected', { id: link.id, profile: link.profile })
      attempted = false
      throw new Error('会话界面未接收分析提示，可重试分析提示')
    }
  } catch (error) {
    host.notify({ kind: 'error', message: (attempted ? '会话已关联；分析提示发送结果待确认，请打开会话检查；' : saved ? '会话已关联；' : '创建或关联未完成；') + (error.message || String(error)) })
  } finally { startingSessions.delete(task.id); await refresh?.() }
}

function TaskCard({ task, activeZt, editorName = 'VS Code', expanded = true, onToggle, reviewData = {} }) {
  const sessions = useSessions()
  const chips = (sessions.data?.zt_sessions || {})[task.id] || []
  const profile = host.state.focusedSessionProfile?.get() || host.state.profile?.get() || 'default'
  const preferred = chips.find(s => (s.profile || 'default') === profile) || chips[0]
  const [choosing, setChoosing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [candidate, setCandidate] = useState('')
  const [sessionSearch, setSessionSearch] = useState('')
  const linkTrigger = useRef(null)
  const [busy, setBusy] = useState(false)
  const [linked, setLinked] = useState(null)
  const run = async fn => { if (busy) return; setBusy(true); try { await fn() } catch (error) { host.notify({ kind: 'error', message: error.message || String(error) }) } finally { setBusy(false) } }
  const candidates = sessions.data?.candidates || []
  const [detailDir, setDetailDir] = useState(null)
  const details = task.repos.find(repo => repo.dir === detailDir)
  useEffect(() => {
    if (detailDir !== null && !details) setDetailDir(null)
  }, [detailDir, details])
  const detailTrigger = useRef(null)
  const title = taskIdentity(task.id, sessions.data?.zt_sessions)
  const summary = taskReviewSummary(task, reviewData)
  const pill = (label, tone = 'muted') => jsx('span', { className: 'db-pill db-pill-' + tone, children: label })
  return jsxs('section', { className: cn('db-card', activeZt === task.id && 'db-card-active'), children: [
    jsxs('div', { className: 'db-card-head', children: [
      jsxs('button', { type: 'button', className: 'db-task-toggle', 'aria-expanded': expanded, onClick: onToggle, children: [
        jsx('span', { 'aria-hidden': true, children: expanded ? '⌄' : '›' }),
        jsxs('span', { className: 'db-task-heading', children: [
          jsxs('span', { className: 'db-title', children: [jsx('span', { className: 'db-ref', children: taskPrefix(task.id, sessions.data?.zt_sessions) }), ' ', jsx('strong', { title, children: title.startsWith(taskPrefix(task.id, sessions.data?.zt_sessions) + ' ') ? title.slice(taskPrefix(task.id, sessions.data?.zt_sessions).length + 1) : title })] }),
          jsx('span', { className: 'db-meta', children: task.repos.length + ' 个仓库' + (summary.known ? ' · ' + summary.merged + '/' + summary.reviews.length + ' 已合并' : '') }),
          summary.known && summary.reviews.length ? jsx('span', { className: 'db-progress', children: jsx('span', { style: { width: (summary.merged / summary.reviews.length * 100) + '%' } }) }) : null
        ] })
      ] }),
      summary.needs ? pill('需要处理', 'warn') : summary.done ? pill('已全部合并', 'good') : summary.known ? pill(summary.reviews.length ? summary.pending + ' 个待合并' : '无关联审阅', summary.reviews.length ? 'warn' : 'muted') : pill('合并进度未知'),
      jsxs('div', { className: 'db-task-actions', children: [
        !preferred && !linked ? jsxs('span', { className: 'db-task-actions', children: [
          jsx(Button, { variant: 'ghost', size: 'sm', disabled: busy || sessions.isLoading || sessions.isError || !sessions.data, onClick: event => { linkTrigger.current = event?.currentTarget; setCandidate(''); setSessionSearch(''); setLinking(true) }, children: '关联已有会话' }),
          jsx(Button, { variant: 'ghost', size: 'sm', disabled: busy || sessions.isLoading || sessions.isError || !sessions.data, onClick: () => run(() => createTaskSession(task, sessions.refetch)), children: '创建会话' })
        ] }) : null,
        linking && !preferred && !linked ? workspaceDialog({ open: true, onOpenChange: setLinking, returnFocus: linkTrigger,
          title: '关联已有会话', description: '搜索并选择准确的 profile / session ID，然后确认。取消不会保存。',
          children: jsxs('div', { children: [
            jsx('input', { autoFocus: true, type: 'search', className: 'db-search', 'aria-label': '搜索会话', value: sessionSearch, onChange: event => setSessionSearch(event.target.value) }),
            jsx('div', { className: 'db-candidates', children: candidates.filter(s => [s.title, s.id, s.profile].join(' ').toLowerCase().includes(sessionSearch.toLowerCase())).map(s => jsx(Button, {
              variant: candidate === JSON.stringify([s.profile, s.id]) ? 'secondary' : 'ghost',
              'aria-pressed': candidate === JSON.stringify([s.profile, s.id]), onClick: () => setCandidate(JSON.stringify([s.profile, s.id])),
              children: (s.title || '无标题') + ' · ' + s.profile + ' · ' + s.id
            }, JSON.stringify([s.profile, s.id]))) })
          ] }),
          footer: jsxs('div', { children: [jsx(Button, { variant: 'secondary', onClick: () => setLinking(false), children: '取消' }), jsx(Button, {
            disabled: busy || !candidates.some(s => JSON.stringify([s.profile, s.id]) === candidate), children: '确认关联', onClick: () => run(async () => {
              const selected = candidates.find(s => JSON.stringify([s.profile, s.id]) === candidate)
              if (!selected) throw new Error('请选择列表中的会话')
              const result = await rest('/task_session', { method: 'POST', body: { task: task.id, action: 'link', id: selected.id, profile: selected.profile } })
              if (!result?.ok || !result.link) throw new Error(result?.detail || '保存会话关联失败')
              setLinked(result.link); setLinking(false); await sessions.refetch?.()
            })
          })] })
        }) : null,
        linked && !preferred ? jsx(Button, { ref: linkTrigger, variant: 'ghost', size: 'sm', onClick: () => openTaskSession(linked), children: '▷ 打开会话' }) : null,
        preferred?.prompt_state === 'attempting' ? jsx('span', { className: 'db-meta', children: '分析提示已尝试发送，请在会话中确认' }) : null,
        preferred?.prompt_state === 'pending' ? jsx(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => run(() => createTaskSession(task, sessions.refetch)), children: '重试分析提示' }) : null,
        preferred ? jsx(Button, { ref: linkTrigger, variant: 'ghost', size: 'sm', title: '打开会话', 'aria-expanded': chips.length > 1 ? choosing : undefined, onClick: () => chips.length > 1 ? setChoosing(!choosing) : openTaskSession(preferred), children: '▷ 打开会话' }) : null,
          choosing && chips.length > 1 ? jsx(Select, { value: '', onValueChange: (value) => {
            const s = chips.find((s) => JSON.stringify([s.profile || 'default', s.id]) === value)
            if (s) { setChoosing(false); return openTaskSession(s) }
          }, children: [
            jsx(SelectTrigger, { children: jsx(SelectValue, { placeholder: '选择会话' }) }),
            jsx(SelectContent, { children: chips.map((s) => jsx(SelectItem, { value: JSON.stringify([s.profile || 'default', s.id]), className: 'whitespace-normal break-words', title: (s.profile || 'default') + ' · ' + s.title, children: (s.profile || 'default') + ' · ' + s.title }, JSON.stringify([s.profile || 'default', s.id]))) })
          ] }) : null,

        jsx(Button, { variant: 'ghost', size: 'sm', title: '在 ' + editorName + ' 打开', onClick: () => openEditor(task.id, editorName), children: '在 ' + editorName + ' 打开 ↗' })
      ] })
    ] }),
    expanded ? jsxs('table', { className: 'db-repo-table', children: [
      jsx('thead', { children: jsx('tr', { children: ['仓库', '分支 + 最新提交', '合并请求', '目标分支', '状态', ''].map(label => jsx('th', { scope: 'col', children: label }, label)) }) }),
      ...task.repos.map(r => {
        const entry = reviewData[r.dir]
        const data = entry?.branch === r.branch ? entry.data : null
        const reviews = data?.reviews || []
        return jsxs('tbody', { children: [
          jsxs('tr', { children: [
            jsxs('td', { 'data-label': '仓库', children: [jsx('strong', { className: 'db-repo-name', title: r.dir, children: r.repo }), jsx(WorktreeActions, { repo: r }), r.dirty > 0 ? jsx('span', { className: 'db-dirty', children: '● ' + r.dirty + ' 未提交' }) : null] }),
            jsxs('td', { 'data-label': '分支 + 最新提交', children: [jsx('div', { className: 'db-branch', title: r.branch || '(detached)', children: r.branch || '(detached)' }), jsxs('div', { className: 'db-commit', title: r.last || '—', children: [jsx('span', { className: 'db-hash', children: (r.last || '—').split(' ')[0] }), ' ' + (r.last || '').split(' ').slice(1).join(' ')] })] }),
            jsx('td', { 'data-label': '合并请求', children: reviews.length ? reviews.map(v => jsx('button', { type: 'button', className: 'db-table-link', title: v.title, onClick: () => openReview(v.url), children: (v.provider === 'gitlab' ? '!' : '#') + v.number + ' ↗' }, v.url)) : '—' }),
            jsx('td', { 'data-label': '目标分支', className: 'db-target', children: reviews.length ? [...new Set(reviews.map(v => v.target_branch))].map(v => jsx('div', { title: v, children: '↳ ' + v }, v)) : '—' }),
            jsx('td', { 'data-label': '状态', children: reviews.length ? reviews.map(v => pill(v.state === 'merged' ? '✓ 已合并' : v.draft ? '草稿' : v.state === 'closed' ? '已关闭' : '待合并', v.state === 'merged' ? 'good' : v.draft || v.state === 'closed' ? 'muted' : 'warn')) : pill(entry?.error ? '查询失败' : !data ? '加载中' : ['ok', 'empty'].includes(data.status) ? '无关联审阅' : ['error', 'timeout', 'partial'].includes(data.status) ? '查询失败' : '未配置') }),
            jsx('td', { children: jsx('button', { type: 'button', className: 'db-row-action', 'aria-label': r.repo + ' 审阅详情', 'aria-haspopup': 'dialog', onClick: event => { detailTrigger.current = event?.currentTarget; setDetailDir(r.dir) }, children: '⋯' }) })
          ] })
        ] }, r.dir)
      })
    ] }) : null,
    details ? workspaceDialog({ open: true, returnFocus: detailTrigger, onOpenChange: open => { if (!open) setDetailDir(null) },
      title: details.repo + ' · 代码审阅', description: title,
      children: jsxs('div', { children: [
        jsx('p', { className: 'db-dialog-path', children: details.dir }),
        jsxs('p', { className: 'db-dialog-path', children: [jsx(Codicon, { name: 'git-branch', size: 12 }), ' ', details.branch || '(detached)'] }),
        jsx('p', { className: 'db-meta', children: details.last || '暂无提交信息' }),
        jsx(ReviewLinks, { repo: details, showRepo: false })
      ] }) }) : null
  ] })
}

function BoardPage() {
  const board = useBoard()
  const sessions = useActiveZt()
  const activeZt = sessions.active?.id
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [collapsed, setCollapsed] = useState(null)
  const [overrides, setOverrides] = useState({})
  const [reviewData, setReviewData] = useState({})
  const onData = useMemo(() => (dir, branch, data, error) => setReviewData(prev => ({ ...prev, [dir]: { branch, data, error } })), [])
  if (board.isLoading) return jsx(EmptyState, { title: '加载 worktree…' })
  if (board.isError) return jsx(EmptyState, { title: '后端不可用', description: board.error?.message })
  if (staleBackend(board.data)) return staleNotice()
  const tasks = board.data?.tasks || []
  const sorted = activeZt ? [...tasks.filter(t => t.id === activeZt), ...tasks.filter(t => t.id !== activeZt)] : tasks
  const repos = [...new Map(tasks.flatMap(t => t.repos).map(r => [r.dir, r])).values()]
  const summaries = tasks.map(t => taskReviewSummary(t, reviewData))
  const known = summaries.length > 0 && summaries.every(s => s.known)
  const visible = sorted.filter(t => {
    const title = (sessions.data?.zt_sessions?.[t.id] || []).map(s => s.title + ' ' + s.label).join(' ')
    const matches = (t.id + ' ' + title + ' ' + t.repos.map(r => r.repo + ' ' + (r.branch || '') + ' ' + (r.last || '') + ' ' + (reviewData[r.dir]?.branch === r.branch ? (reviewData[r.dir]?.data?.reviews || []).map(v => v.title + ' ' + v.number + ' ' + v.target_branch).join(' ') : '')).join(' ')).toLowerCase().includes(search.toLowerCase())
    const summary = taskReviewSummary(t, reviewData)
    return matches && (status === 'all' || (status === 'pending' ? summary.waiting : summary.done))
  })
  return jsxs(ScrollArea, { className: 'dev-board db-page h-full', children: [boardStyle(),
    ...repos.map(repo => jsx(BoardReviewObserver, { repo, onData }, repo.dir)),
    jsxs('div', { className: 'db-board-content', children: [
      jsxs('header', { className: 'db-page-header', children: [
        jsxs('div', { children: [jsx('div', { className: 'db-eyebrow', children: 'WORKSPACE / DEV BOARD' }), jsx('h1', { children: '跨仓任务工作区' }), jsx('p', { children: '集中查看任务、关联仓库与合并进度。' })] }),
        jsx(RestoreWorktrees, { repos: board.data?.hidden_repos || [], refresh: board.refetch }), jsx(Button, { variant: 'secondary', size: 'sm', onClick: () => openDock(sessions.data?.zt_sessions || {}), children: '在会话右侧打开' })
      ] }),
      jsxs('div', { className: 'db-toolbar db-board-toolbar', children: [
        jsx('input', { type: 'search', className: 'db-search', 'aria-label': '搜索任务', placeholder: '搜索任务、仓库或 PR/MR…', value: search, onChange: e => setSearch(e.target.value) }),
        jsx('select', { 'aria-label': '审阅状态', value: status, onChange: e => setStatus(e.target.value), children: [['all', '全部审阅状态'], ['pending', '待处理'], ['done', '已全部合并']].map(([value, label]) => jsx('option', { value, children: label }, value)) }),
        jsx(Button, { variant: 'ghost', size: 'sm', 'aria-pressed': collapsed === true, onClick: () => { setCollapsed(collapsed !== true); setOverrides({}) }, children: collapsed === true ? '全部展开' : '全部折叠' }),
        jsx(Button, { variant: 'ghost', size: 'sm', 'aria-label': '刷新', title: '刷新', disabled: board.isFetching, onClick: () => board.refetch(), children: '↻' })
      ] }),
      jsxs('div', { className: 'db-board-count', children: [
        jsxs('span', { children: [jsx('b', { children: tasks.length }), ' 个任务'] }),
        jsxs('span', { children: [jsx('b', { children: repos.length }), ' 个关联仓库'] }),
        known ? jsxs('span', { children: [jsx('b', { className: 'db-accent', children: summaries.reduce((n, s) => n + s.pending, 0) }), ' 个待合并'] }) : jsx('span', { children: '合并进度待确认' }),
        jsxs('span', { children: [jsx('b', { children: summaries.filter(s => s.needs).length }), ' 个任务需要处理'] })
      ] }),
      ...visible.map(t => {
        const expanded = overrides[t.id] ?? (collapsed === null ? t.id === sorted[0]?.id || t.id === activeZt : !collapsed)
        return jsx(TaskCard, { task: t, activeZt, editorName: board.data?.editor_name || 'VS Code', reviewData, expanded, onToggle: () => setOverrides(prev => ({ ...prev, [t.id]: !expanded })) }, t.id)
      }),
      !visible.length ? jsx('p', { className: 'db-meta', children: '没有匹配的任务' }) : null
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
      closeDock?.()
      closeDock = null
    })
    boardFetch = (path, options) => ctx.rest(path, options)
    openExternal = (url) => ctx.os.openExternal(url)
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


function WorktreeActions({ repo }) {
  const board = useBoard()
  const [open, setOpen] = useState(false)
  const [deleteDirectory, setDeleteDirectory] = useState(false)
  const [identity, setIdentity] = useState(null)
  const [busy, setBusy] = useState(false)
  const trigger = useRef(null)
  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await rest('/worktree', { method: 'POST', body: { dir: repo.dir, action: identity ? 'remove' : deleteDirectory ? 'preview' : 'hide', ...(identity || {}) } })
      if (deleteDirectory && !identity) { setIdentity(result); return }
      if (!result?.ok) throw new Error(result?.detail || '操作失败')
      setOpen(false); await board.refetch?.()
    } catch (error) { host.notify({ kind: 'error', message: error.message || String(error) }) }
    finally { setBusy(false) }
  }
  return jsxs('span', { children: [jsx(Button, { variant: 'ghost', size: 'sm', onClick: event => { trigger.current = event?.currentTarget; setDeleteDirectory(false); setIdentity(null); setOpen(true) }, children: '移除 Worktree' }),
    open ? workspaceDialog({ open, onOpenChange: setOpen, returnFocus: trigger, title: identity ? '再次确认删除目录' : '移除 Worktree',
      description: '默认只持久隐藏，可恢复。隐藏不会阻止 cron 自动清理。',
      children: identity ? jsxs('div', { children: [jsx('p', { className: 'db-dialog-path', children: identity.dir }), jsx('p', { className: 'db-dialog-path', children: identity.branch }), jsx('p', { className: 'db-dialog-path', children: identity.head })] }) : jsx('label', { children: [jsx('input', { type: 'checkbox', checked: deleteDirectory, onChange: event => setDeleteDirectory(event.target.checked) }), '同时删除本地目录（需要再次确认）'] }),
      footer: jsxs('div', { children: [jsx(Button, { variant: 'secondary', onClick: () => setOpen(false), children: '取消' }), jsx(Button, { disabled: busy, onClick: submit, children: identity ? '确认删除目录' : deleteDirectory ? '下一步' : '确认隐藏' })] })
    }) : null] })
}

function RestoreWorktrees({ repos, refresh }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const trigger = useRef(null)
  return jsxs('span', { children: [jsx(Button, { variant: 'secondary', size: 'sm', onClick: event => { trigger.current = event?.currentTarget; setOpen(true) }, children: '恢复隐藏仓库' }),
    open ? workspaceDialog({ open, onOpenChange: setOpen, returnFocus: trigger, title: '恢复隐藏仓库', description: '隐藏不会阻止 cron 自动清理。', children: jsx('div', { className: 'db-candidates', children: repos.length ? repos.map(repo => jsx(Button, { variant: 'secondary', disabled: busy, children: repo.dir, onClick: async () => {
      setBusy(true)
      try { const result = await rest('/worktree', { method: 'POST', body: { dir: repo.dir, action: 'restore' } }); if (!result?.ok) throw new Error('恢复失败'); await refresh?.() }
      catch (error) { host.notify({ kind: 'error', message: error.message || String(error) }) }
      finally { setBusy(false) }
    } }, repo.dir)) : '暂无隐藏仓库' }) }) : null] })
}
