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
状态按配置推进，支持编辑、删除、置顶及拖拽排序。
置顶任务优先显示，排序限定在相同状态的置顶/普通组内。状态筛选和
标题、任务编号(ref)、备注搜索均在客户端执行。链接通过系统浏览器打开，不抓取外部任务，不接入 cron。

**开始会话** 使用当前网关 profile 的 `session.create({title})` RPC 创建真实会话，
该接口会在打开前持久化标题，再调用 `host.openSession` 打开。`host.newChat` 仅创建草稿，
不提供所需的标题与会话 ID。任务保存会话 ID/profile，打开成功后标记进行中；后续按钮变为
**打开会话**，复用已有会话。完成或删除任务不会删除聊天，编辑任务不会重命名关联会话。

会话标题在 ref 非空时为 `${ref} ${title}`，否则仅为标题。ref 是自由格式的外部编号，
例如 `GH-12`、`ZT-1234` 或 `JIRA-100`，不做任何跟踪系统解析。两个插件可独立安装、启用和卸载，互不调用 API、导入代码或读取对方配置。
任务清单不会自动创建 worktree。

界面沿用 Hermes 主题：统一页头、等高工具栏、三列看板和列表。新建/编辑使用弹窗；点击任务标题查看详情和更新状态；删除需确认，已完成任务可重新打开。标签管理为独立弹窗。两个面板分别通过侧边栏入口打开，不共享任务存储。

拖动卡片或列表行可在同状态、同置顶分段内前后排序；筛选隐藏的任务仍会保留。跨列拖动仅改变状态，不改变置顶。

权威数据由网关后端保存在 `$HERMES_HOME/task-board/tasks.json`，不使用桌面 storage。
前端通过 `ctx.rest` 调用 FastAPI：`GET/POST /tasks`、`PATCH/DELETE /tasks/{id}`，
以及 `POST /tasks/{id}/reorder`（`{"target_id":"10","placement":"before"}` 或 `"after"`，兼容原有 `direction: up/down`）。
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

## 自定义状态与手动同步（API v3）

工具栏 **管理状态** 可添加、编辑名称/颜色/类别，使用上移/下移调整顺序。
状态和标签一起保存在 `tasks.json` 的 `statuses` 列表，每项包含稳定的 `id`、`name`、`color`、`category`。
旧数据默认：todo / 待办 / gray、doing / 进行中 / blue、done / 已完成 / green。
ID 使用 ASCII 字母、数字、下划线或短横线；名称非空且最多 40 字；颜色沿用八色标签调色板。
`todo`、`doing`、`done` 类别各至少一个。所有看板列、筛选、统计和选择器按配置生成。
新任务默认第一个待办类状态；开始任务进入第一个进行类，重新打开进入第一个待办类。
进行类任务推进到后续配置的进行/完成类状态（无后续则进入第一个完成类）。原有会话和拖拽逻辑保留。

`GET /statuses` 返回定义；`GET /tasks` 同时返回 `statuses` 和 `api_version: 4`。
`PUT /statuses` 提交完整有序 `statuses` 及 `migrations`（删除状态 → 保留状态，例如 `{"todo":"backlog"}`）。
删除在用状态必须明确迁移目标；配置与任务迁移一次原子保存，其他任务字段保留。内置 ID 也允许删除，外部导入器需读取首个待办类 ID。

**刷新** 仅重读已存储数据。可选的 **立即同步** 运行所有者配置的本地适配脚本。
所有者可在 `$HERMES_HOME/task-board/settings.json` 设置 `{"sync_script":"/absolute/path/to/workflow-sync.py"}`，
必须是现有 `.py` 文件的绝对路径。这是可信的本地代码执行配置，仅由本地所有者决定；客户端不得传入命令、路径或参数。
使用网关的 Python 解释器执行，无 shell；独立进程组限时 180 秒，超时清理子进程。仓库不负责安装或配置适配器。

`GET /sync` 无副作用，返回 `available`、`running`、`last_result`；未配置时不显示按钮。
`POST /sync` 非阻塞启动后台任务，同一进程运行期间重复请求不再启动脚本。
仅运行时轮询，完成后重读任务（含状态定义）及标签；失败信息持续可见，可重试。同步 API 不自动推进任务状态。
脚本可输出 JSON 汇总，只提取 `created`、`updated`、`skipped`、`failed`、`total` 的非负整数计数。
可选 `stage_exits` 数组最多含 100 个 -255 至 255 的整数退出码，不含阶段名称。
响应仅含白名单计数/退出码、时间戳及简短生成结果，不返回原始输出、stderr、凭据或异常文本。

## 启动分析提示（API v4）

开始任务会在打开准确的 stored session 后，向已确认新建且为空的会话发送中文分析提示，
包含 `title`、`ref`、`url`、`note`，要求先读取详情与相关技能、分析需求和影响范围，
提出简洁方案，本轮先不修改代码。已有任务关联或同名会话只打开，不重发，无特定任务平台逻辑。

`start_prompt_state` 保存 `pending`、`attempting`、`claimed`、`failed` 或空字符串。
**重试分析提示** 显式重试 pending/failed 状态，检查关联 profile、空历史、无待处理请求和草稿文本，
保留用户草稿。`claimed` 只表示界面接收请求，不表示模型完成。
中断或保存失败可能留下不确定的 `attempting`，不会自动重发；请打开会话检查记录后手动发送。
需同时更新前后端至 API v4。默认模板固定，本次不新增设置页面。

发送前通过 `POST /tasks/{id}/start-prompt/claim` 在任务锁内将 pending/failed 原子认领为 attempting，必须准确匹配 `session_id` 与 `session_profile`；竞争者收到 409 后停止发送。修改会话关联或提示状态的 PATCH 必须携带 `expected_start`，包含旧 session_id、session_profile、start_prompt_state（缺省按空字符串）。迟到的关联写入及重启断链重置会被拒绝，claimed/attempting 不允许回写 pending。

唯一旧客户端兼容窗口：PATCH 不含 `expected_start`，字段仅含 `session_id`、`session_profile`、`session_title` 中的字段，且当前这三个关联字段及 `start_prompt_state` 均为空时，允许首次绑定。检查与保存均在任务锁内，后续或并发竞争失败的绑定返回 409；此窗口不能修改提示状态，其他关联/提示 PATCH 仍须 CAS。
