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
optional external reference (`ref`), note and tracker link (`url`); cycle status through todo → doing → done → todo,
delete, pin, or move rows up/down within their pinned/unpinned group. Pinned tasks appear first.
The All / Todo / Doing / Done tabs and search (title, reference and note) filter locally.
Tracker links open in the system browser; no ticket fetching or cron ingestion occurs.

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

The Hermes-themed UI shares header/navigation and toolbar sizing with Dev Board. Create/edit tasks in a dialog, click a task title for details and status changes, confirm deletion, and reopen completed tasks. Label management uses a separate dialog. The repository-view navigation opens an installed Dev Board; task storage remains separate.

Canonical data lives in `$HERMES_HOME/task-board/tasks.json`, owned by the gateway backend,
not desktop storage. CRUD and reorder use `ctx.rest` and the plugin's FastAPI routes
(`GET/POST /tasks`, `PATCH/DELETE /tasks/{id}`, `POST /tasks/{id}/reorder` with
`{"direction":"up"}` or `{"direction":"down"}`). Writes use a lock, fsync and atomic replacement;
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
