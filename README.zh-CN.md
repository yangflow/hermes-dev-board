# Hermes Boards

[English](README.md) | **简体中文**

两个独立的 Hermes Desktop 插件，可分别安装或同时使用。

- **Dev Board**：跨仓 worktree、文件变更、代码审阅和编辑器入口。
- **Task Board**：带标签和关联聊天会话的独立任务清单。

| 需求 | 安装 | 指南 |
|---|---|---|
| 查看 worktree 变更与代码审阅 | Dev Board | [Dev Board](dev-board/README.zh-CN.md) |
| 管理任务并启动带标题的聊天 | Task Board | [Task Board](task-board/README.zh-CN.md) |
| 两者都需要 | 独立安装两个插件 | 见上述指南 |

每个插件目录都包含完整的 `desktop/plugin.js` 与 `dashboard/{manifest.json,plugin_api.py}`。按各自指南从 `dev-board/*` 或 `task-board/*` 复制到对应安装目录；不会自动迁移现有安装。测试保留在 `tests/`。

[MIT 许可证](LICENSE)
