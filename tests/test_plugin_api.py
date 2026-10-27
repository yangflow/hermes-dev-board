import json
import os
from pathlib import Path
import shlex
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dashboard import plugin_api as api


class PluginApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.worktrees = self.root / "worktrees"
        self.worktrees.mkdir()
        self.home = self.root / "hermes"
        self.env = patch.dict(os.environ, {
            "DEV_BOARD_WORKTREE_ROOTS": str(self.worktrees),
            "HERMES_HOME": str(self.home),
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        app = FastAPI()
        app.include_router(api.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def repo(self, name):
        repo = self.worktrees / name
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        (repo / "adminapi").mkdir()
        (repo / "adminapi" / "views.py").write_text("before\n")
        subprocess.run(["git", "add", "."], cwd=repo, check=True)
        subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                        "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"], cwd=repo, check=True)
        return repo

    def editor(self, body):
        script = self.root / "fake editor.py"
        script.write_text(body)
        os.environ["DEV_BOARD_EDITOR"] = shlex.join([sys.executable, str(script), "--reuse-window"])

    def test_fake_git_preserves_porcelain_leading_column(self):
        result = subprocess.CompletedProcess([], 0, " M adminapi/views.py\n", "")
        with patch.object(api.subprocess, "run", return_value=result):
            self.assertEqual(api._run(["git", "status"]), " M adminapi/views.py")

    def test_real_git_first_unstaged_file_and_numstat(self):
        repo = self.repo("service-1234")
        (repo / "adminapi" / "views.py").write_text("after\nnew\n")
        changes = self.client.get("/changes", params={"dir": str(repo)}).json()
        self.assertEqual(changes["files"], [{"status": "M", "file": "adminapi/views.py"}])
        task = self.client.get("/task_changes?task=1234").json()
        self.assertEqual(task["files"], [{"repo": "service", "dir": str(repo), "path": "adminapi/views.py",
                                         "status": "M", "added": 2, "removed": 1}])
        self.assertEqual(self.client.get("/board").json()["tasks"][0]["repos"][0]["dirty"], 1)

    def test_post_executes_configured_command_with_exact_workspace_folders(self):
        first = self.repo("service-1234")
        second = self.repo("other repo-1234")
        self.repo("unrelated-9999")
        record = self.root / "editor-result.json"
        self.editor("import json, pathlib, sys\n"
                    f"pathlib.Path({str(record)!r}).write_text(json.dumps(sys.argv[1:]))\n")
        self.assertEqual(self.client.get("/open_editor?task=1234").status_code, 405)
        response = self.client.post("/open_editor?task=1234")
        self.assertEqual(response.status_code, 200, response.text)
        args = json.loads(record.read_text())
        self.assertEqual(args[0], "--reuse-window")
        workspace = Path(args[1])
        self.assertEqual(workspace.name, "Task-1234.code-workspace")
        self.assertEqual(response.json()["opened"], [str(workspace)])
        self.assertTrue(workspace.is_relative_to(self.home / "cache" / "dev-board" / "workspaces"))
        self.assertEqual(json.loads(workspace.read_text())["folders"], [
            {"name": second.name, "path": str(second)}, {"name": first.name, "path": str(first)}])
        # Reopening refreshes the generated workspace after a worktree disappears.
        with patch.object(api, "_task_worktrees", return_value=[(first, "1234", "-1234")]):
            self.assertEqual(self.client.post("/open_editor?task=1234").status_code, 200)
        self.assertEqual(len(json.loads(workspace.read_text())["folders"]), 1)

    def test_editor_display_preserves_supported_app_names_and_invalid_config(self):
        for editor, expected in [("Visual Studio Code", "VS Code"),
                                 ("/Applications/Visual Studio Code.app", "VS Code"),
                                 ("cursor --reuse-window", "cursor"), ("'invalid", "配置的编辑器")]:
            with self.subTest(editor=editor), patch.dict(os.environ, {"DEV_BOARD_EDITOR": editor}):
                self.assertEqual(self.client.get("/board").json()["editor_name"], expected)

    def test_workspace_filename_escapes_task_and_default_editor_metadata(self):
        repo = self.repo("service-1234")
        os.environ.pop("DEV_BOARD_EDITOR", None)
        self.assertEqual(self.client.get("/board").json()["editor_name"], "VS Code")
        with patch.object(api, "_task_worktrees", return_value=[(repo, "../1234", "-1234")]), \
                patch.object(api.subprocess, "run"):
            response = self.client.post("/open_editor", params={"task": "../1234"})
        self.assertEqual(response.status_code, 200)
        workspace = Path(response.json()["opened"][0])
        self.assertEqual(workspace.name, "Task-..%2F1234.code-workspace")
        self.assertEqual(workspace.parent, self.home / "cache/dev-board/workspaces")

    def test_workspace_uses_session_label_and_keeps_identity_safe(self):
        repo = self.repo("service-9246")
        self.database(self.home / "state.db", [{"id": "s", "title": "ZT-9246 actual task"}])
        self.editor("pass")
        result = self.client.post("/open_editor?task=9246")
        self.assertEqual(Path(result.json()["opened"][0]).name, "ZT-9246.code-workspace")
        self.assertEqual(self.client.get("/board").json()["api_version"], api.API_VERSION)
        names = []
        for task, label in [("9246", "../GH-9246"), ("9246", "%2F-9246"), ("../9246", "GH-../9246")]:
            with patch.object(api, "_task_worktrees", return_value=[(repo, task, "-9246")]), \
                    patch.object(api, "task_sessions", return_value={"zt_sessions": {task: [{"label": label}]}}):
                first = self.client.post("/open_editor", params={"task": task}).json()["opened"][0]
                second = self.client.post("/open_editor", params={"task": task}).json()["opened"][0]
            self.assertEqual(first, second)
            self.assertEqual(Path(first).parent, self.home / "cache/dev-board/workspaces")
            names.append(first)
        self.assertEqual(len(set(names)), len(names))

    def test_real_editor_process_failure_is_http_error(self):
        self.repo("service-1234")
        self.editor("import sys\nprint('editor rejected workspace', file=sys.stderr)\nsys.exit(7)\n")
        response = self.client.post("/open_editor?task=1234")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], "editor rejected workspace")

    def test_macos_default_waits_for_launcher_and_reports_timeout(self):
        self.repo("service-1234")
        os.environ.pop("DEV_BOARD_EDITOR", None)
        with patch.object(api.sys, "platform", "darwin"), patch.object(api.subprocess, "run") as run:
            run.return_value = subprocess.CompletedProcess([], 0, "", "")
            self.assertEqual(self.client.post("/open_editor?task=1234").status_code, 200)
            args, kwargs = run.call_args
            self.assertEqual(args[0][:3], ["open", "-a", "Visual Studio Code"])
            self.assertTrue(args[0][3].endswith(".code-workspace"))
            self.assertTrue(kwargs["check"])
            self.assertEqual(kwargs["timeout"], 15)
            run.side_effect = subprocess.TimeoutExpired(args[0], 15)
            response = self.client.post("/open_editor?task=1234")
            self.assertEqual(response.status_code, 504)
            self.assertIn("timed out", response.json()["detail"])

    def test_missing_task_or_command_never_returns_success(self):
        self.assertEqual(self.client.post("/open_editor?task=1234").status_code, 404)
        self.repo("service-1234")
        os.environ["DEV_BOARD_EDITOR"] = str(self.root / "missing-editor")
        self.assertEqual(self.client.post("/open_editor?task=1234").status_code, 500)

    def test_macos_app_names_fall_back_to_open_while_cli_commands_keep_arguments(self):
        self.repo("service-1234")
        cases = [
            ("Cursor", None, ["open", "-a", "Cursor"]),
            ("'Sublime Text'", None, ["open", "-a", "Sublime Text"]),
            ("/Applications/Cursor.app", None, ["open", "-a", "/Applications/Cursor.app"]),
            ("Cursor", "/usr/local/bin/Cursor", ["Cursor"]),
            ("code", "/usr/local/bin/code", ["code"]),
            ("code --reuse-window", "/usr/local/bin/code", ["code", "--reuse-window"]),
            ("'/tmp/editor tool' --wait", "/tmp/editor tool", ["/tmp/editor tool", "--wait"]),
            ("missing-editor --wait", None, ["missing-editor", "--wait"]),
        ]
        for editor, executable, expected in cases:
            with self.subTest(editor=editor, executable=executable), \
                    patch.dict(os.environ, {"DEV_BOARD_EDITOR": editor}), \
                    patch.object(api.sys, "platform", "darwin"), \
                    patch.object(api.shutil, "which", return_value=executable) as which, \
                    patch.object(api.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
                response = self.client.post("/open_editor?task=1234")
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(run.call_args.args[0], expected + response.json()["opened"])
                if len(shlex.split(editor)) == 1 and not editor.endswith(".app"):
                    which.assert_called_once_with(shlex.split(editor)[0])

    def test_real_process_timeout_is_http_error(self):
        self.repo("service-1234")
        self.editor("import time\ntime.sleep(10)\n")
        run = subprocess.run

        def short_timeout(args, **kwargs):
            self.assertEqual(kwargs.pop("timeout"), 15)
            return run(args, timeout=0.05, **kwargs)

        with patch.object(api.subprocess, "run", side_effect=short_timeout):
            response = self.client.post("/open_editor?task=1234")
        self.assertEqual(response.status_code, 504)
        self.assertIn("timed out", response.json()["detail"])

    def database(self, path, rows):
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as con:
            con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, source TEXT DEFAULT 'desktop',"
                        " model_config TEXT, parent_session_id TEXT, end_reason TEXT, hidden INTEGER DEFAULT 0,"
                        " archived INTEGER DEFAULT 0, last_activity_at REAL DEFAULT 1)")
            for row in rows:
                con.execute(f"INSERT INTO sessions ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values()))

    def test_session_profiles_lineage_and_subagent_filter(self):
        default = self.home / "state.db"
        dev = self.home / "profiles" / "dev" / "state.db"
        self.database(default, [{"id": "same-id", "title": "GH-1234 default"}])
        self.database(dev, [
            {"id": "same-id", "title": "ZT-1234 dev"},
            {"id": "root", "title": "ZT-1234 compressed", "end_reason": "compression"},
            {"id": "middle", "parent_session_id": "root", "end_reason": "compression"},
            {"id": "tip", "parent_session_id": "middle", "last_activity_at": 5},
            {"id": "branch", "title": "GH-5555 branch", "parent_session_id": "root", "model_config": '{"_branched_from":"root"}'},
            {"id": "reset", "title": "GH-6666 reset", "parent_session_id": "root", "model_config": '{"_reset_from":"root"}'},
            {"id": "sub-source", "title": "ZT-1234 child", "source": "subagent"},
            {"id": "sub-title", "title": "Subagent: ZT-1234 child"},
            {"id": "sub-marker", "title": "ZT-1234 child", "model_config": '{"_delegate_from":"root"}'},
            {"id": "hidden", "title": "ZT-1234 hidden", "hidden": 1},
            {"id": "archived", "title": "ZT-1234 archived", "archived": 1},
        ])
        os.environ["DEV_BOARD_SESSION_DBS"] = os.pathsep.join([str(default), str(dev)])
        before = [p.read_bytes() for p in (default, dev)]
        mapping = self.client.get("/zt_sessions").json()["zt_sessions"]
        entries = mapping["1234"]
        self.assertEqual({(s["id"], s["profile"]) for s in entries},
                         {("same-id", "default"), ("same-id", "dev"), ("tip", "dev")})
        tip = next(s for s in entries if s["id"] == "tip")
        self.assertEqual(tip["session_ids"], ["tip", "middle", "root"])
        self.assertEqual(tip["label"], "ZT-1234")
        self.assertEqual(mapping["5555"][0]["session_ids"], ["branch"])
        self.assertEqual(mapping["6666"][0]["session_ids"], ["reset"])
        self.assertEqual(before, [p.read_bytes() for p in (default, dev)])

    def test_invalid_model_configs_do_not_discard_sessions_or_compression_lineage(self):
        configs = ['{"broken":', "null", "[]", '["value"]', '"text"', "42", "true", None, ""]
        for index, config in enumerate(configs):
            with self.subTest(model_config=config):
                db = self.home / f"sessions-{index}.db"
                self.database(db, [
                    {"id": "healthy", "title": "ZT-1234 healthy", "model_config": "{}", "last_activity_at": 10},
                    {"id": "unrelated", "title": "unrelated session", "model_config": config},
                    {"id": "configured", "title": "GH-5678 task", "model_config": config},
                    {"id": "root", "title": "ZT-7890 compressed", "end_reason": "compression"},
                    {"id": "middle", "parent_session_id": "root", "end_reason": "compression", "model_config": config},
                    {"id": "tip", "parent_session_id": "middle", "model_config": "{}", "last_activity_at": 5},
                ])
                os.environ["DEV_BOARD_SESSION_DBS"] = str(db)
                response = self.client.get("/zt_sessions")
                self.assertEqual(response.status_code, 200)
                mapping = response.json()["zt_sessions"]
                self.assertEqual(set(mapping), {"1234", "5678", "7890"})
                self.assertEqual([s["id"] for s in mapping["1234"]], ["healthy"])
                self.assertEqual([s["id"] for s in mapping["5678"]], ["configured"])
                self.assertEqual([s["session_ids"] for s in mapping["7890"]], [["tip", "middle", "root"]])


if __name__ == "__main__":
    unittest.main()
