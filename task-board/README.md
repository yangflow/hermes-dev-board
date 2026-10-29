# Task Board

[English](README.md) | [简体中文](README.zh-CN.md) | [Repository](../README.md)

This repository provides two independent plugins: Dev Board (worktree board/dock, reviews and editor opening) and Task Board (`task-board`), each with one sidebar entry. Run the following commands from the repository root to copy `task-board/*` into the corresponding target directories (no automatic migration of existing installations):

```bash
mkdir -p ~/.hermes/desktop-plugins/task-board ~/.hermes/plugins/task-board
cp task-board/desktop/plugin.js ~/.hermes/desktop-plugins/task-board/
cp -r task-board/dashboard ~/.hermes/plugins/task-board/
```

Append `task-board` to the gateway config's existing `plugins.enabled` list, preserving other entries, then restart the gateway and Desktop. Dev Board need not be enabled.

Open the standalone **Task Board** sidebar entry, or run **Task Board：打开任务清单**
from the command palette (`/tasks`). This is a simple TODO list: create/edit a required title,
optional external reference (`ref`), note and tracker link (`url`); advance through configured statuses,
delete, pin, or drag rows within their pinned/unpinned group. Pinned tasks appear first.
The All / Todo / Doing / Done tabs and search (title, reference and note) filter locally.
Tracker links open in the system browser; no ticket fetching or cron ingestion occurs automatically.

**开始会话** creates a real session on the current gateway profile using the supported
`session.create({title})` RPC, then opens it with `host.openSession`. Unlike `host.newChat`,
which only opens an untitled draft, titled creation persists the session title before opening.
The task stores its session ID/profile and becomes doing after opening succeeds; subsequent
clicks offer **打开会话** and reuse that session. Completing/deleting a task does not delete its chat.
Editing a task does not rename its linked session.

Session titles use `${ref} ${title}` when `ref` is set, otherwise just the title.
References are free-form strings (for example `GH-12`, `ZT-1234`, or `JIRA-100`); no tracker parsing occurs.
Both plugins can be installed,
enabled and removed independently, without API calls, imports or configuration references to each other.
No worktree is created automatically.

The Hermes-themed UI shares header styling and toolbar sizing with Dev Board. Create/edit tasks in a dialog, click a task title for details and status changes, confirm deletion, and reopen completed tasks. Label management uses a separate dialog. Both boards open from their own sidebar entries; task storage remains separate.

Drag cards or list rows before/after another task in the same status and pinned segment. Filters retain hidden tasks; cross-column drops only change status.

Canonical data lives in `$HERMES_HOME/task-board/tasks.json`, owned by the gateway backend,
not desktop storage. CRUD and reorder use `ctx.rest` and the plugin's FastAPI routes
(`GET/POST /tasks`, `PATCH/DELETE /tasks/{id}`, `POST /tasks/{id}/reorder` with
`{"target_id":"10","placement":"before"}` (or `"after"`); legacy `{"direction":"up"}` / `{"direction":"down"}` remain supported). Writes use a lock, fsync and atomic replacement;
invalid/unreadable storage is reported rather than overwritten. The file retains task fields,
creation/update timestamps, order, pin state and session linkage across restarts.


## Labels

Tasks have a `labels` list (default `[]`). Use the edit form's chips to toggle multiple labels; rows display their colors. The **All labels** dropdown combines one label with the status tab and text search, entirely on the client.

Open the **管理标签** dialog to add a name and choose one of eight preset colors: `red`, `orange`, `amber`, `green`, `teal`, `blue`, `violet`, `gray`. Each existing row offers a rename input, color palette, save and delete buttons. Names are trimmed, non-empty strings of at most 40 characters; task labels are deduplicated and must reference existing definitions. Renaming updates all referencing tasks; deleting removes the label from them. Neither operation deletes tasks.

Definitions are stored globally within Task Board's `tasks.json` as `"labels": {"bug": "red"}`; each task stores `"labels": ["bug"]`. Older files without these fields default to empty definitions/lists. This data is independent of Dev Board.

| API | Body / query |
|---|---|
| `GET /labels` | Returns `{"labels": {name: color}}` |
| `POST /labels` | `{"name":"bug","color":"red"}` |
| `PATCH /labels` | `{"name":"bug","new_name":"fix","color":"teal"}` (`new_name` and `color` optional) |
| `DELETE /labels?name=fix` | URL-encoded label name |
| `POST /tasks`, `PATCH /tasks/{id}` | Existing task fields plus `"labels": ["bug"]`; `[]` clears assignments |

Validation failures return meaningful 400 errors; missing definitions on rename/delete return 404. Writes retain the existing locking and atomic replacement behavior.

## Uninstall

Remove `~/.hermes/plugins/task-board` and `~/.hermes/desktop-plugins/task-board`, remove `task-board` from `plugins.enabled`, and restart gateway and Desktop.

## License

[MIT](../LICENSE)

## Custom statuses and manual sync (API v3)

**管理状态** edits the ordered status definitions stored alongside labels in `tasks.json`:
`statuses: [{"id":"todo","name":"待办","color":"gray","category":"todo"}, ...]`.
Older files default to todo / 待办 / gray, doing / 进行中 / blue, done / 已完成 / green.
IDs are stable ASCII letters, digits, underscores or hyphens; names are nonempty and at most 40 characters.
Colors use the label palette. At least one status in each category (`todo`, `doing`, `done`) is required.
Columns, filters, statistics and selectors follow this order; use up/down buttons in the manager to reorder.
New tasks use the first todo status. Starting moves to first doing, reopening to first todo;
doing tasks advance to the next configured doing/done status (or first done).

`GET /statuses` returns definitions; `GET /tasks` includes `statuses` and `api_version: 4`.
`PUT /statuses` accepts the full ordered `statuses` and an explicit `migrations` map,
for example `{"todo":"backlog"}` when removing todo. Removing a used status requires a surviving target.
Definitions and migrated task statuses save in one atomic transaction; other task fields are preserved.
The built-in IDs may be removed. External importers must use the configured first todo ID.

Manual sync is optional and separate from **刷新**, which only reloads stored data.
An owner can configure `$HERMES_HOME/task-board/settings.json` with
`{"sync_script":"/absolute/path/to/workflow-sync.py"}`. The file must exist and end in `.py`.
This is a trusted local code execution setting: only the owner-local configuration chooses the adapter;
HTTP clients cannot supply a script, command or arguments. It runs with the gateway Python interpreter,
without a shell, in a separate process group, with a 180-second timeout that kills descendants.
No adapter is installed or configured by this repository.

`GET /sync` is read-only and returns `available`, `running`, `last_result`; without configuration no sync button appears.
`POST /sync` starts one background job per process; repeated clicks while running do not spawn another.
**立即同步** polls only while running and refreshes tasks (including statuses) and labels on completion.
Failures remain visible and can be retried. Sync never automatically changes task state in the board API.
Adapters may emit a JSON summary with nonnegative integer `created`, `updated`, `skipped`, `failed`, `total` counts.
An optional `stage_exits` array may contain up to 100 integer exit codes (-255 to 255), without stage names.
Only these sanitized counts/exit codes, timestamps and a short generated outcome are exposed; raw stdout/stderr,
credentials and exception text are never returned. Status changes remain explicit user actions or adapter-owned behavior.

## Start analysis prompt (API v4)

Starting a new, verified empty session submits a Chinese analysis-only prompt containing
`title`, `ref`, `url`, and `note` after opening the exact stored session. It asks the agent
to read task details and relevant skills, analyze requirements, impact and open questions,
and propose a concise plan without changing code this turn. Existing linked or exact-title
sessions are opened without sending. No tracker-specific behavior is added.

`start_prompt_state` persists `pending`, `attempting`, `claimed`, `failed`, or an empty string.
**重试分析提示** explicitly retries pending/failed prompts, checking the linked profile,
empty history, no pending requests and draft text first. User drafts are preserved.
`claimed` means the composer surface accepted the request, not model completion.
An interrupted `attempting` state is ambiguous and is never automatically retried;
open the session to check its transcript before sending manually. API v4 requires
updating both the desktop plugin and backend. The default template is fixed.

Before dispatch, `POST /tasks/{id}/start-prompt/claim` atomically changes pending/failed to attempting under the task lock and requires the exact `session_id` and `session_profile`. Only one competing client succeeds; HTTP 409 stops dispatch. PATCHes that change session linkage or prompt state require `expected_start` containing the previous session ID, profile and prompt state (missing fields use empty strings). Stale linkage writes and restart resets are rejected, and claimed/attempting cannot be changed back to pending.

The only legacy compatibility window is a PATCH without `expected_start` whose fields contain only `session_id`, `session_profile`, and/or `session_title`, while all three stored linkage fields and `start_prompt_state` are empty. This first binding is checked and saved under the task lock; subsequent or competing bindings return 409. It cannot change prompt state; all other linkage/prompt PATCHes still require CAS.
