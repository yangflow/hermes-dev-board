# Hermes Boards

**English** | [简体中文](README.zh-CN.md)

Two independent plugins for Hermes Desktop. Install either or both.

- **Dev Board**: cross-repository worktrees, changes, reviews and editor opening.
- **Task Board**: a standalone task list with labels and linked chat sessions.

| Need | Install | Guide |
|---|---|---|
| Inspect development worktrees and code reviews | Dev Board | [Dev Board](dev-board/README.md) |
| Track tasks and start titled chats | Task Board | [Task Board](task-board/README.md) |
| Both workflows | Both independently | See both guides above |

Each directory contains a complete plugin: `desktop/plugin.js` and `dashboard/{manifest.json,plugin_api.py}`. Copy files from `dev-board/*` or `task-board/*` to the corresponding installation directories as shown in each guide; existing installations are not moved automatically. Tests remain in `tests/`.

[MIT License](LICENSE)
