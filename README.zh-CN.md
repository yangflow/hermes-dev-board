# Hermes Dev Board

[English](README.md) | **简体中文**

面向 [Hermes Agent](https://hermes-agent.nousresearch.com) Desktop 的跨仓库 worktree 插件。按任务编号聚合多个仓库，在主会话聊天窗口右侧查看当前任务的变更目录树与文件对比。

![Dev Board 脱敏界面示意图](docs/board.png)

> 界面示意图使用虚构的任务、仓库、分支与代码，不包含真实项目数据；布局用于展示功能。

## 功能

- **全局看板**：按任务聚合 worktree，显示仓库、分支、最近提交、未提交数量和关联会话入口。
- **会话右侧面板**：跟随当前聚焦会话的任务编号，查看该任务涉及的多个仓库。
- **仓库筛选**：默认显示全部仓库，可下拉选择具体仓库。
- **变更目录树**：折叠目录、压缩单链目录、显示文件及目录的增删行数。
- **文件对比**：点击变更文件，左右对照旧版和新版，显示行号与新增、删除底色。
- **编辑器入口**：将任务对应的 worktree 传给配置的编辑器。

当前目录树展示的是未提交的变更文件；对比以 HEAD 为基准。文件对比尚无语法高亮。看板每 15 秒刷新，其他视图刷新行为以当前实现为准。

## 安装

需要支持桌面插件的 Hermes Desktop、Git，以及网关环境中的 FastAPI。

先克隆仓库，在仓库目录执行：

```bash
git clone https://github.com/yangflow/hermes-dev-board.git
cd hermes-dev-board
mkdir -p ~/.hermes/plugins/dev-board
cp -r dashboard ~/.hermes/plugins/dev-board/
mkdir -p ~/.hermes/desktop-plugins/dev-board
cp desktop/plugin.js ~/.hermes/desktop-plugins/dev-board/
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
| `DEV_BOARD_WORKTREE_ROOTS` | `~/.worktrees:~/code/.worktrees:~/code/.tmp-worktrees` | 冒号分隔的 worktree 扫描根目录 |
| `DEV_BOARD_TASK_RE` | `-(\d{2,6})$` | 提取 worktree 目录名末尾的任务编号，使用第一个捕获组 |
| `DEV_BOARD_TITLE_RE` | `([A-Za-z]+-\d{2,6})` | 提取会话标题中的任务标签，使用第一个捕获组，再取标签末尾数字关联 worktree |
| `DEV_BOARD_SESSION_DBS` | `$HERMES_HOME/state.db` 及其 `profiles/*/state.db` | 冒号分隔的会话数据库路径 |
| `DEV_BOARD_EDITOR` | macOS 为 `Visual Studio Code`，其他系统为 `code` | 打开工作目录的编辑器 |

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
- 编辑器入口会启动本机配置的编辑器进程；其他功能用于读取数据。
- 路径参数受扫描根目录约束。仅安装并启用可信的本地插件。

## 卸载

删除安装的 `plugins/dev-board` 和 `desktop-plugins/dev-board` 目录，并从对应配置的 `plugins.enabled` 中移除 `dev-board`，随后重启网关和 Desktop。

## 许可证

[MIT](LICENSE)，版权归 yangflow 所有。
