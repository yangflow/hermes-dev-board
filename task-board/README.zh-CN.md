# Task Board

[English](README.md) | [简体中文](README.zh-CN.md) | [Repository](../README.md)

本仓库提供两个独立插件：Dev Board（跨仓开发板、worktree 面板、代码审阅和编辑器打开）与 Task Board（`task-board`），各自只有一个侧边栏入口。在仓库根目录执行以下命令，将 `task-board/*` 复制到对应目标目录（不会自动迁移现有安装）：

```bash
mkdir -p ~/.hermes/desktop-plugins/task-board ~/.hermes/plugins/task-board
cp task-board/desktop/plugin.js ~/.hermes/desktop-plugins/task-board/
cp -r task-board/dashboard ~/.hermes/plugins/task-board/
```

在网关所用配置的 `plugins.enabled` 列表追加 `task-board`，保留其他插件，然后重启网关和 Desktop。只需任务清单时无需启用 Dev Board。

从独立的侧边栏入口 **Task Board**，或命令面板 **Task Board：打开任务清单**
打开 `/tasks`。这是简单 TODO 清单：标题必填，任务编号(ref)、备注、链接(url) 可选；
点击状态按待办 → 进行中 → 已完成 → 待办切换，支持编辑、删除、置顶及上下移动。
置顶任务优先显示，上下移动限定在各自置顶/普通组内。全部/待办/进行中/已完成筛选和
标题、任务编号(ref)、备注搜索均在客户端执行。链接通过系统浏览器打开，不抓取外部任务，不接入 cron。

**开始会话** 使用当前网关 profile 的 `session.create({title})` RPC 创建真实会话，
该接口会在打开前持久化标题，再调用 `host.openSession` 打开。`host.newChat` 仅创建草稿，
不提供所需的标题与会话 ID。任务保存会话 ID/profile，打开成功后标记进行中；后续按钮变为
**打开会话**，复用已有会话。完成或删除任务不会删除聊天，编辑任务不会重命名关联会话。

会话标题在 ref 非空时为 `${ref} ${title}`，否则仅为标题。ref 是自由格式的外部编号，
例如 `GH-12`、`ZT-1234` 或 `JIRA-100`，不做任何跟踪系统解析。两个插件可独立安装、启用和卸载，互不调用 API、导入代码或读取对方配置。
任务清单不会自动创建 worktree。

界面沿用 Hermes 主题：页头与仓库视图入口、等高工具栏、三列看板和列表。新建/编辑使用弹窗；点击任务标题查看详情和更新状态；删除需确认，已完成任务可重新打开。标签管理为独立弹窗。仓库视图入口打开已安装的 Dev Board，不共享任务存储。

权威数据由网关后端保存在 `$HERMES_HOME/task-board/tasks.json`，不使用桌面 storage。
前端通过 `ctx.rest` 调用 FastAPI：`GET/POST /tasks`、`PATCH/DELETE /tasks/{id}`，
以及 `POST /tasks/{id}/reorder`（`{"direction":"up"}` 或 `{"direction":"down"}`）。
文件保存任务内容、创建/更新时间、顺序、置顶和会话关联，重启后保留；写入使用锁、fsync
和原子替换，损坏或不可读的数据会报错，不覆盖原文件。

## 标签

每个任务拥有 `labels` 列表，默认为 `[]`。编辑表单中点击标签色点和名称可多选，任务行显示彩色标签。**All labels** 下拉框可选择一个标签，并与状态页签、文本搜索组合过滤，全部在客户端完成。

打开 **管理标签** 弹窗 可新建名称并选择八种预设颜色之一：`red`、`orange`、`amber`、`green`、`teal`、`blue`、`violet`、`gray`。已有标签行提供重命名输入、调色板、保存和删除按钮。名称去除首尾空白，必填且最多 40 个字符；任务标签会去重，必须引用已存在的定义。重命名同步更新所有关联任务，删除标签同步移除任务中的引用，不删除任务。

Task Board 的 `tasks.json` 全局保存 `"labels": {"bug": "red"}` 定义，每个任务保存 `"labels": ["bug"]`。旧文件缺少字段时默认为空定义和空列表。数据完全独立于 Dev Board。

| API | 请求体 / 查询参数 |
|---|---|
| `GET /labels` | 返回 `{"labels": {name: color}}` |
| `POST /labels` | `{"name":"bug","color":"red"}` |
| `PATCH /labels` | `{"name":"bug","new_name":"fix","color":"teal"}`（`new_name`、`color` 可选） |
| `DELETE /labels?name=fix` | URL 编码的标签名称 |
| `POST /tasks`、`PATCH /tasks/{id}` | 原任务字段加 `"labels": ["bug"]`；`[]` 清空关联 |

校验失败返回明确的 400 错误，重命名/删除不存在的标签返回 404。沿用已有锁保护及原子写入机制。

## 卸载

删除 `~/.hermes/plugins/task-board` 和 `~/.hermes/desktop-plugins/task-board`，从 `plugins.enabled` 移除 `task-board`，重启网关与 Desktop。

## 许可证

[MIT](../LICENSE)
