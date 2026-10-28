# Hermes Dev Board

[English](README.md) | **简体中文**

面向 [Hermes Agent](https://hermes-agent.nousresearch.com) Desktop 的跨仓库 worktree 插件。按任务编号聚合多个仓库，在主会话聊天窗口右侧查看当前任务的变更目录树与文件对比。

> 界面截图将在实际插件运行验证后补充。

## 功能

- **全局看板**：按任务聚合 worktree，显示仓库、分支、最近提交、未提交数量和关联会话入口。
- **会话右侧面板**：跟随当前聚焦会话的任务编号，查看该任务涉及的多个仓库。
- **仓库筛选**：默认显示全部仓库，可下拉选择具体仓库。
- **变更目录树**：折叠目录、压缩单链目录、显示文件及目录的增删行数。
- **文件对比**：点击变更文件，左右对照旧版和新版，显示行号与新增、删除底色。
- **代码审阅**：全局仓库行和聊天侧栏均显示 PR/MR 数量、标题、目标分支、状态和草稿，支持手工链接与刷新。
- **编辑器入口**：默认在 VS Code 中打开任务的多目录工作区，可配置兼容的启动命令。

当前目录树展示的是未提交的变更文件；对比以 HEAD 为基准。文件对比尚无语法高亮。看板每 15 秒刷新，其他视图刷新行为以当前实现为准。

## 安装

需要支持桌面插件的 Hermes Desktop、Git，以及网关环境中的 FastAPI。

从仓库根目录将 `dev-board/*` 复制到对应目标目录，不会自动迁移现有安装。先克隆仓库，在仓库目录执行：

```bash
git clone https://github.com/yangflow/hermes-dev-board.git
cd hermes-dev-board
mkdir -p ~/.hermes/plugins/dev-board
cp -r dev-board/dashboard ~/.hermes/plugins/dev-board/
mkdir -p ~/.hermes/desktop-plugins/dev-board
cp dev-board/desktop/plugin.js ~/.hermes/desktop-plugins/dev-board/
```

在网关使用的配置文件中，将 `dev-board` **追加**到已有的 `plugins.enabled` 列表，保留其他插件。例如默认 profile 使用 `~/.hermes/config.yaml`：

```yaml
plugins:
  enabled:
    - dev-board
```

桌面前端插件位于应用级目录 `~/.hermes/desktop-plugins/`；后端安装和启用配置需对应实际服务请求的网关/profile。使用自定义 `HERMES_HOME` 时调整路径。

重启网关和 Desktop。侧边栏打开 **Dev Board**；在主聊天窗口使用命令面板搜索 **Dev Board：会话右侧 Worktree 面板**，即可并排显示面板。

## 配置

以下环境变量需在启动网关前设置。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `DEV_BOARD_WORKTREE_ROOTS` | `~/.worktrees:~/code/.worktrees` | 冒号分隔的 worktree 扫描根目录 |
| `DEV_BOARD_TEMP_ROOTS` | `~/.hermes/.tmp-worktrees:~/code/.tmp-worktrees` | 冒号分隔的临时集成根目录，默认排除；显式列入 `DEV_BOARD_WORKTREE_ROOTS` 的目录优先保留 |
| `DEV_BOARD_TASK_RE` | `-(\d{2,6})$` | 提取 worktree 目录名末尾的任务编号，使用第一个捕获组 |
| `DEV_BOARD_TITLE_RE` | `([A-Za-z]+-\d{2,6})` | 提取会话标题中的任务标签，使用第一个捕获组，再取标签末尾数字关联 worktree |
| `DEV_BOARD_SESSION_DBS` | `$HERMES_HOME/state.db` 及其 `profiles/*/state.db` | 冒号分隔的会话数据库路径 |
| `DEV_BOARD_REVIEW_HOSTS` | `{"github.com":"github"}` | JSON：域名 → `github` 或 `gitlab`，其他域名需显式配置 |
| `DEV_BOARD_EDITOR` | macOS 为 `Visual Studio Code`，其他系统为 `code` | 打开工作目录的编辑器 |


打开时会在 `$HERMES_HOME/cache/dev-board/workspaces` 生成 VS Code 格式的
`Task-9246.code-workspace` 文件，仅包含该任务实际发现的目录。这些本地缓存含绝对路径，不应提交。
`DEV_BOARD_EDITOR` 只替换启动命令（支持 shell 风格引号，不执行 shell 展开），不会改变工作区格式；
应使用 `code`、`cursor` 等支持此格式的启动程序，并非任意编辑器均可使用。
macOS 应用名或 `.app` 路径通过 `open -a` 打开，其他命令保留参数。
按钮显示配置的启动程序名称；成功提示表示启动命令执行完成。

### 代码审阅链接

推荐使用 `$HERMES_HOME/dev-board/settings.json`（默认 `~/.hermes/dev-board/settings.json`）：

```json
{"review_hosts":{"gitlab.com":"gitlab","git.example.com":"gitlab"}}
```

该可选文件在每次审阅请求时读取；修改后点击刷新审阅即可，无需重启网关。
文件仅接受可选的 `review_hosts` 字段，值必须为域名到 `github` 或 `gitlab` 的映射。
JSON、结构或文件读取错误会明确显示，不输出文件内容。默认仍启用 `github.com`；
`DEV_BOARD_REVIEW_HOSTS` 按域名覆盖文件配置。环境变量必须进入实际运行的网关进程，修改需重启；
插件不会读取 `.env`。以下仅为格式示例，不需要配置 token：

```bash
export DEV_BOARD_REVIEW_HOSTS='{"github.com":"github","gitlab.com":"gitlab","git.example.com":"gitlab","github.example.com":"github"}'
export DEV_BOARD_WORKTREE_ROOTS="$HOME/projects/.worktrees"
```

默认仅自动查询 `github.com`；GitLab.com 及自建域名均需显式配置。支持 HTTPS、SSH URL 和
`git@git.example.com:group/repo.git` 格式；远端内嵌的账号凭据不会出现在响应或存储中。
SSH 端口仅用于 Git 传输；HTTPS 域名配置可包含端口。

审阅关联严格使用 worktree 当前分支和仓库远端，远端依次取
`branch.<branch>.pushRemote`、`remote.pushDefault`、`branch.<branch>.remote`、`origin`，
使用该远端的 push URL（包括 `remote.<name>.pushurl`）。
不根据任务编号或标题猜测。分离 HEAD、缺少/无效远端、错误域名配置会显示错误。
接口仅接受看板实际发现的 worktree，拒绝任意仓库路径和符号链接越界。

网关通过已登录的 `gh api --method GET` / `glab api --method GET` 只读查询精确仓库和来源分支，
并逐条复核来源仓库与分支。查询的是远端仓库内的审阅；目标位于其他 fork 仓库的审阅不在此查询范围。
包含 open/closed/merged 与草稿，按 provider/编号去重，编号降序排列。请以**网关运行的系统用户**
在 CLI 中完成对应域名登录，并确保网关 PATH 中有 `gh` / `glab`。插件不存 token、不创建或修改 PR/MR。
缺少 CLI、认证/权限或服务错误、超时、域名未配置、成功但无结果分别显示，不把失败显示为“无审阅”。
原始 CLI 错误文本可能包含凭据，因此不直接返回。

审阅每 60 秒独立刷新，与 15 秒看板扫描分开。后端缓存最多 256 个仓库/分支/provider 条目，
有效期 60 秒（包括失败状态）。点击“刷新审阅”强制重新查询；API 为
`GET /reviews?dir=<已发现worktree>&force=true`。每次查询的 CLI 总超时为 15 秒。
按下一页响应头分页，缺失响应头时满页继续，最多 10 页、每页 100 条；达到上限明确显示“结果不完整”，
中途失败显示错误，不宣称已完整查询。

点击“添加链接”使用内置 URL 表单，“移除”仅删除手工关联。仅允许不含账号密码的 HTTP(S) URL，
未知域名也可使用，无需 CLI 登录。插件**永不抓取手工 URL**，也不抓标题或状态，不虚构 PR/MR 元数据。
数据保存在 `$HERMES_HOME/cache/dev-board/review-links.json`（默认 `~/.hermes/cache/dev-board/review-links.json`），
按脱敏仓库身份与精确分支隔离；相同身份/分支的 worktree 共享关联，重启后仍保留。
写入接口为 `POST /review_links?dir=…&action=add|remove&url=…`，线程锁保护并原子替换文件；
文件损坏或不可读时显示错误，不覆盖原数据。点击链接通过 SDK `ctx.os.openExternal` 打开，打开失败会提示。
右侧任务选择、全部/单仓筛选、变更文件和文件对比继续保留。

### 任务编号与命名约定

任务无需使用 ZT 前缀。例如：

```text
会话：GH-101 payment retry
目录：api-service-101
目录：admin-web-101
```

上述两个 worktree 均关联任务 `101`。默认会话匹配支持 `ZT-101`、`GH-101`、`TASK-101`；纯数字标题需自行配置正则，例如：

```bash
export DEV_BOARD_WORKTREE_ROOTS="$HOME/projects/.worktrees"
export DEV_BOARD_TITLE_RE='(\d{2,6})'
```

当前以数字部分关联任务：`GH-101` 和 `TASK-101` 会归入同一任务，需避免编号冲突。目录名默认以 `-编号` 结尾；其他命名方式需配置 `DEV_BOARD_TASK_RE`。

## 数据与权限

- 插件会读取配置根目录下的 Git 状态、文件差异及匹配会话的标题。
- 会话数据库以 SQLite 只读模式打开。
- 编辑器入口会启动本机配置的编辑器进程；手工审阅链接只写入本地关联文件，审阅发现只读。
- 路径参数受扫描根目录约束。仅安装并启用可信的本地插件。

## 卸载

删除安装的 `plugins/dev-board` 和 `desktop-plugins/dev-board` 目录，并从对应配置的 `plugins.enabled` 中移除 `dev-board`，随后重启网关和 Desktop。

## 许可证

[MIT](../LICENSE)，版权归 yangflow 所有。

