r"""Dev Board backend — worktree board by task id, session mapping, changes, diff, editor open.

All knobs are environment variables (set them on the gateway process):
  DEV_BOARD_WORKTREE_ROOTS  colon-separated worktree roots
                            (default: ~/.worktrees:~/code/.worktrees:~/code/.tmp-worktrees)
  DEV_BOARD_TASK_RE         regex for the task-id suffix of a worktree dir
                            (default: -(\d{2,6})$  e.g. repo-1234 -> task 1234)
  DEV_BOARD_TITLE_RE        regex extracting a task id from a session title
                            (default: ([A-Za-z]+-\d{2,6})  e.g. "ZT-9248 xxx", "GH-12 fix")
  DEV_BOARD_SESSION_DBS     colon-separated state.db paths; default scans
                            $HERMES_HOME/state.db plus $HERMES_HOME/profiles/*/state.db
  DEV_BOARD_EDITOR          editor open command (default: macOS "Visual Studio Code",
                            otherwise "code")
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()


def _roots() -> list[Path]:
    raw = os.environ.get("DEV_BOARD_WORKTREE_ROOTS")
    if raw:
        candidates = [Path(p).expanduser() for p in raw.split(":") if p.strip()]
    else:
        home = Path.home()
        candidates = [home / ".worktrees", home / "code" / ".worktrees", home / "code" / ".tmp-worktrees"]
    return [c for c in candidates if c.is_dir()]


_TASK_RE = re.compile(os.environ.get("DEV_BOARD_TASK_RE", r"-(\d{2,6})$"))
_TITLE_RE = re.compile(os.environ.get("DEV_BOARD_TITLE_RE", r"([A-Za-z]+-\d{2,6})"))


def _run(args: list[str], cwd: Path | None = None, timeout: int = 15) -> str:
    try:
        out = subprocess.run(args, cwd=str(cwd) if cwd else None, capture_output=True, text=True, timeout=timeout)
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def _task_worktrees() -> list[tuple[Path, str, str]]:
    rows = []
    for root in _roots():
        for d in sorted(root.iterdir()):
            if not d.is_dir() or d.name.startswith(".") or not (d / ".git").exists():
                continue
            m = _TASK_RE.search(d.name)
            if m:
                rows.append((d, m.group(1), m.group(0)))
    return rows


def _validate_dir(dir_: str) -> Path:
    d = Path(dir_).resolve()
    if not any(str(d).startswith(str(r.resolve()) + "/") for r in _roots()):
        raise HTTPException(status_code=403, detail="dir not under worktree roots")
    if not (d / ".git").exists():
        raise HTTPException(status_code=404, detail="not a worktree")
    return d


def _session_dbs() -> list[Path]:
    raw = os.environ.get("DEV_BOARD_SESSION_DBS")
    if raw:
        return [Path(p).expanduser() for p in raw.split(":") if p.strip()]
    home = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()
    dbs = [home / "state.db"]
    if (home / "profiles").is_dir():
        dbs += sorted((home / "profiles").glob("*/state.db"))
    return [db for db in dbs if db.exists()]


@router.get("/board")
def board() -> dict:
    tasks: dict[str, list] = {}
    for d, zt, suffix in _task_worktrees():
        status = _run(["git", "status", "--porcelain"], d)
        tasks.setdefault(zt, []).append(
            {
                "repo": d.name[: -len(suffix)],
                "dir": str(d),
                "branch": _run(["git", "branch", "--show-current"], d),
                "dirty": len([l for l in status.splitlines() if l.strip()]),
                "last": _run(["git", "log", "-1", "--format=%h %s"], d),
            }
        )
    return {"tasks": [{"id": k, "repos": v} for k, v in sorted(tasks.items(), reverse=True)]}


@router.get("/zt_sessions")
def task_sessions() -> dict:
    """Task number -> sessions whose title carries a matching id, across profile stores."""
    import sqlite3

    out: dict[str, list] = {}
    for db in _session_dbs():
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            for sid, title in con.execute(
                "select id, title from sessions"
                " where title is not null and coalesce(hidden,0)=0 and coalesce(archived,0)=0"
                " order by last_activity_at desc"
            ):
                m = _TITLE_RE.search(title or "")
                if not m:
                    continue
                full = m.group(1)
                num = re.search(r"(\d+)$", full)
                if num:
                    out.setdefault(num.group(1), []).append({"id": sid, "title": title, "label": full})
            con.close()
        except Exception:
            continue
    return {"zt_sessions": out}


@router.get("/task_changes")
def task_changes(task: str = Query(...)) -> dict:
    files: list[dict] = []
    repos: list[dict] = []
    for d, zt, suffix in _task_worktrees():
        if zt != task:
            continue
        repo = d.name[: -len(suffix)]
        repos.append({"repo": repo, "dir": str(d), "dirty": 0})
        status: dict[str, str] = {}
        for l in _run(["git", "status", "--porcelain", "--untracked-files=all"], d).splitlines():
            if l.strip():
                status[l[3:].strip().strip('"')] = (l[:2].strip() or "?")
        numstat: dict[str, tuple[str, str]] = {}
        for l in _run(["git", "diff", "HEAD", "--numstat"], d, timeout=30).splitlines():
            parts = l.split("\t")
            if len(parts) == 3:
                numstat[parts[2].strip()] = (parts[0], parts[1])
        for path, st in status.items():
            added, removed = numstat.get(path, ("0", "0"))
            if path not in numstat and st == "?":
                try:
                    added = str((d / path).read_text(errors="replace").count("\n") + 1)
                except Exception:
                    added = "0"
            files.append({
                "repo": repo, "dir": str(d), "path": path, "status": st,
                "added": 0 if added == "-" else int(added),
                "removed": 0 if removed == "-" else int(removed),
            })
        repos[-1]["dirty"] = sum(1 for f in files if f["repo"] == repo)
    return {"files": files, "repos": repos}


@router.get("/changes")
def changes(dir: str = Query(...)) -> dict:
    d = _validate_dir(dir)
    lines = _run(["git", "status", "--porcelain", "--untracked-files=all"], d).splitlines()
    files = [
        {"status": (l[:2].strip() or "?"), "file": l[3:].strip().strip('"')}
        for l in lines
        if l.strip()
    ]
    tracked = len([l for l in _run(["git", "ls-files"], d).splitlines() if l.strip()])
    return {"files": files, "tracked": tracked}


@router.get("/diff")
def diff(dir: str = Query(...), file: str = Query(...)) -> dict:
    d = _validate_dir(dir)
    if ".." in file or file.startswith("/"):
        raise HTTPException(status_code=403, detail="bad file path")
    porcelain = _run(["git", "status", "--porcelain", "--", file], d)
    text = _run(["git", "diff", "HEAD", "--", file], d, timeout=25)
    if not text and porcelain.startswith("??"):
        try:
            body = (d / file).read_text(errors="replace")
            lines = body.split("\n")
            if lines and lines[-1] == "":
                lines = lines[:-1]
            text = (
                f"diff --git a/{file} b/{file}\nnew file mode 100644\n"
                f"--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{len(lines)} @@\n"
                + "".join("+" + ln + "\n" for ln in lines)
            )
        except Exception:
            text = f"(unreadable: {file})"
    return {"diff": text[:120000]}


@router.get("/open_editor")
def open_editor(task: str = Query(...)) -> dict:
    """Open all of a task's worktrees in the editor as a multi-root window."""
    dirs = [d for d, zt, _ in _task_worktrees() if zt == task]
    if not dirs:
        raise HTTPException(status_code=404, detail="no worktrees for task")
    roots = _roots()
    code_root = roots[0].parent if roots else Path.home()
    ws = [str(w) for w in code_root.glob(f"*{task}*.code-workspace")]
    targets = ws or [str(d) for d in dirs]
    editor = os.environ.get("DEV_BOARD_EDITOR")
    if not editor:
        editor = "Visual Studio Code" if sys.platform == "darwin" else "code"
    cmd = ["open", "-a", editor] + targets if sys.platform == "darwin" and editor != "code" else [editor] + targets
    try:
        subprocess.Popen(cmd)
        return {"ok": True, "opened": targets}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
