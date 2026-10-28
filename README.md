# Hermes Dev Board

**English** | [简体中文](README.zh-CN.md)

A cross-repo worktree board for the [Hermes Agent](https://hermes-agent.nousresearch.com) desktop app.
It groups git worktrees by **task id** — one feature spanning several repositories shows up as one card
with every repo, branch, last commit and pending-change count — and links the board to your **chat
sessions**, so the panel beside your conversation always shows the worktrees, changed-file tree and
side-by-side diffs of the task you are currently talking about.

> Screenshots will be added after verification against the running plugin.

## What you get

- **Board page** (sidebar → *Dev Board*): every task across all worktree roots, one card per task,
  repo rows with branch / last commit / dirty count, session chips that jump to the related chat.
- **Chat-side dock panel**: opens right next to the conversation. It follows the **focused session** —
  switch sessions and the panel switches to that session's task. Shows:
  - all changed files of the task across repos, with a repo filter dropdown (All / per-repo);
  - a collapsible **directory tree** with per-file `+added / −removed` counts (compact single-child
    chains, VS Code style);
  - a **side-by-side file diff** (old / new columns, own line numbers, add/del/mod row alignment);
  - one-click **open in VS Code**: every worktree of the task in one multi-root window
    (configurable launch command; requires VS Code workspace support).
- **Code review links** in every board repo row and the chat panel (All / per-repo): PRs/MRs, drafts, states, target branches, manual links and refresh.
- 15 s auto-refresh; untracked files get a synthesized `new file` diff.

## Install

Requires the Hermes desktop app with plugin support.

1. **Backend (dashboard plugin API)** — copy to the Hermes home the gateway scans:

   ```bash
   mkdir -p ~/.hermes/plugins/dev-board
   cp -r dashboard ~/.hermes/plugins/dev-board/
   ```

   Then add `dev-board` to the `plugins.enabled` list of the config the gateway runs under
   (for a `--profile default` gateway that is `~/.hermes/config.yaml`):

   ```yaml
   plugins:
     enabled:
       - dev-board
   ```

2. **Frontend (desktop plugin)** — copy to the app-level plugin root:

   ```bash
   mkdir -p ~/.hermes/desktop-plugins/dev-board
   cp desktop/plugin.js ~/.hermes/desktop-plugins/dev-board/
   ```

3. Restart the Hermes desktop app. *Dev Board* appears in the sidebar and ⌘K;
   "Dev Board: worktree panel beside chat" docks the companion panel to the right of the chat.

## Configuration (environment variables on the gateway process)

| Variable | Default | Meaning |
|---|---|---|
| `DEV_BOARD_WORKTREE_ROOTS` | `~/.worktrees:~/code/.worktrees` | Colon-separated worktree roots to scan |
| `DEV_BOARD_TEMP_ROOTS` | `~/.hermes/.tmp-worktrees:~/code/.tmp-worktrees` | Colon-separated temporary integration roots; excluded by default. Explicit `DEV_BOARD_WORKTREE_ROOTS` entries take precedence |
| `DEV_BOARD_TASK_RE` | `-(\d{2,6})$` | Regex for the task-id suffix of a worktree dir (`repo-1234` → task `1234`) |
| `DEV_BOARD_TITLE_RE` | `([A-Za-z]+-\d{2,6})` | Regex extracting a task id from a session title (`ZT-9248 …`, `GH-12 …`) |
| `DEV_BOARD_SESSION_DBS` | `$HERMES_HOME/state.db` + `profiles/*/state.db` | Colon-separated session stores to map sessions → tasks |
| `DEV_BOARD_REVIEW_HOSTS` | `{"github.com":"github"}` | JSON domain → `github` or `gitlab`; additional hosts explicitly enabled |
| `DEV_BOARD_EDITOR` | `Visual Studio Code` (macOS) / `code` | Editor for the multi-root open |

Any ticket prefix works — ZT, GH, JIRA, plain numbers — as long as the title regex matches it.
Nothing is ZT-specific; the prefix shown in the UI is taken from the matched session label.


Opening creates a VS Code `.code-workspace` file such as `Task-9246.code-workspace` in
`$HERMES_HOME/cache/dev-board/workspaces`, containing exactly the task's discovered folders.
These local files contain absolute paths and should not be committed. `DEV_BOARD_EDITOR` changes
only the launch command (shell-style quoting, no shell expansion); the workspace format remains
VS Code's. Use a launcher that accepts this format, such as `code` or `cursor`, not an arbitrary
editor. On macOS app names / `.app` paths use `open -a`; command arguments are otherwise preserved.
The button names the configured launcher; success means the launch command completed.

## Code review links

Prefer `$HERMES_HOME/dev-board/settings.json` (default `~/.hermes/dev-board/settings.json`):

```json
{"review_hosts":{"gitlab.com":"gitlab","git.example.com":"gitlab"}}
```

The optional file is read on every review request: edit it and refresh reviews without restarting the gateway.
Only the optional `review_hosts` key is accepted; its value must map domains to `github` or `gitlab`.
Invalid JSON, schema or unreadable files produce visible errors without exposing contents.
`github.com` remains enabled by default; `DEV_BOARD_REVIEW_HOSTS` overrides file entries per domain.
Environment variables must be set on the running gateway process (restart required); `.env` is not read by this plugin.
Examples only; no token configuration:


```bash
export DEV_BOARD_REVIEW_HOSTS='{"github.com":"github","gitlab.com":"gitlab","git.example.com":"gitlab","github.example.com":"github"}'
export DEV_BOARD_WORKTREE_ROOTS="$HOME/projects/.worktrees"
```

Only `github.com` is enabled by default. GitLab.com and self-hosted domains must be configured.
HTTPS, SSH URLs and scp-style remotes (`git@git.example.com:group/repo.git`) are parsed without exposing
embedded credentials. SSH ports are Git transport ports; HTTPS ports can be included in configured domains.
The source is the current worktree branch and its remote, selected in Git push order:
`branch.<branch>.pushRemote`, `remote.pushDefault`, `branch.<branch>.remote`, then `origin`; its push URL is used (including `remote.<name>.pushurl`).
There is no task-number or title matching for reviews. Detached HEAD, missing/invalid remotes and
invalid host configuration produce visible errors. Discovery is restricted to the board's discovered
worktrees; the review API rejects arbitrary repositories and symlink escapes.

The gateway uses `gh api --method GET` / `glab api --method GET` with the exact repository and source
branch, then verifies source repository and branch in each result. These queries list reviews in the
remote repository; reviews targeting a different fork repository are outside this query's scope.
Open, closed, merged and draft reviews are included, deduplicated by provider/number and sorted by
number descending. Sign in to `gh` / `glab` for the configured host **as the gateway's OS user** using
the CLI's existing login. The plugin neither stores tokens nor creates/edits reviews. The gateway's
PATH must contain the applicable CLI. Missing CLI, authentication/permission/provider errors, timeout,
unsupported host and an empty successful query have separate visible states. Raw CLI diagnostics are
not returned because they can contain credentials.

Reviews have a separate 60-second refresh/cache, independent of the 15-second board scan. The backend
cache holds at most 256 repository/branch/provider entries for 60 seconds (including failed queries).
**刷新审阅** forces a new query; `GET /reviews?dir=<discovered-worktree>&force=true` bypasses the cache.
Each query has a 15-second total CLI timeout. Pagination follows next-page headers, with a conservative
full-page fallback, up to 10 pages of 100 results. Hitting the limit explicitly displays **incomplete**;
failed pages display an error rather than claiming an empty or complete result.

**添加链接** opens a small URL form; **移除** removes that manual association only. Manual links accept
HTTP(S) URLs without credentials, work for unknown hosts and do not require a CLI login. The plugin
**never fetches manual URLs**, including for titles or status. They are stored in
`$HERMES_HOME/cache/dev-board/review-links.json` (default `~/.hermes/cache/dev-board/review-links.json`),
scoped by sanitized repository identity plus exact branch, shared by worktrees with that same identity
and branch, and preserved across restarts. Manual entries are marked as manual and do not invent PR/MR
metadata. Updates use `POST /review_links?dir=…&action=add|remove&url=…`, thread locking and an atomic
file replacement; unreadable/corrupt data is reported without overwriting it. Link clicks open through
the desktop SDK's `ctx.os.openExternal`; failures are displayed. The task selector and changed-file
view continue to work alongside reviews.

## Task list

This repository provides two independent plugins: Dev Board (worktree board/dock, reviews and editor opening) and Task Board (`task-board`), each with one sidebar entry. The Dev Board installation above is unchanged. To install task-board:

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
The All / Todo / Doing / Done tabs and search (title, ID and note) filter locally.
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

Canonical data lives in `$HERMES_HOME/task-board/tasks.json`, owned by the gateway backend,
not desktop storage. CRUD and reorder use `ctx.rest` and the plugin's FastAPI routes
(`GET/POST /tasks`, `PATCH/DELETE /tasks/{id}`, `POST /tasks/{id}/reorder` with
`{"direction":"up"}` or `{"direction":"down"}`). Writes use a lock, fsync and atomic replacement;
invalid/unreadable storage is reported rather than overwritten. The file retains task fields,
creation/update timestamps, order, pin state and session linkage across restarts.

## How it maps tasks

- A **worktree** belongs to task *N* when its directory name matches `DEV_BOARD_TASK_RE`
  (default: ends in `-1234`).
- A **session** belongs to task *N* when its title matches `DEV_BOARD_TITLE_RE`
  (default: contains `PREFIX-1234`). The numeric part joins both sides.

## Security notes

- `changes`/`diff` reject any `dir` outside the configured worktree roots and any `file` with `..`.
- Review discovery is read-only. Manual review-link POSTs write only the local association file;
  `open_editor` spawns the configured editor with paths under the worktree roots.
- Session stores are opened SQLite read-only (`mode=ro`).

## Uninstall

```bash
rm -rf ~/.hermes/plugins/dev-board ~/.hermes/desktop-plugins/dev-board
# and remove dev-board from plugins.enabled
```

## License

MIT
