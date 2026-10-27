r"""Dev Board backend — worktree board by task id, session mapping, changes, diff, editor open.

Configuration uses gateway environment variables, plus optional live review-host
settings in $HERMES_HOME/dev-board/settings.json:
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

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()
API_VERSION = 2

_review_cache = OrderedDict()
_review_cache_lock = threading.Lock()
_manual_links_lock = threading.Lock()
_REVIEW_TTL = 60
_REVIEW_TIMEOUT = 15
_REVIEW_MAX_PAGES = 10


def _review_hosts() -> dict:
    hosts = {"github.com": "github"}

    def merge(configured, source):
        if not isinstance(configured, dict) or any(
            not isinstance(h, str) or not re.fullmatch(r"[A-Za-z0-9.-]+(?::[0-9]+)?", h)
            or p not in ("github", "gitlab") for h, p in configured.items()
        ):
            raise HTTPException(500, f"invalid {source}: expected domain -> github|gitlab JSON object")
        hosts.update({h.lower(): p for h, p in configured.items()})

    settings = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser() / "dev-board/settings.json"
    try:
        data = json.loads(settings.read_text(encoding="utf-8"))
    except FileNotFoundError:
        data = {}
    except (OSError, ValueError):
        raise HTTPException(500, "cannot read dev-board/settings.json: expected valid JSON settings object")
    if not isinstance(data, dict) or set(data) - {"review_hosts"}:
        raise HTTPException(500, "invalid dev-board/settings.json: expected object with optional review_hosts")
    merge(data.get("review_hosts", {}), "dev-board/settings.json review_hosts")
    try:
        configured = json.loads(os.environ.get("DEV_BOARD_REVIEW_HOSTS", "{}"))
    except (TypeError, ValueError):
        raise HTTPException(500, "invalid DEV_BOARD_REVIEW_HOSTS: expected domain -> github|gitlab JSON object")
    merge(configured, "DEV_BOARD_REVIEW_HOSTS")
    return hosts


def _review_remote(raw: str) -> tuple[str, str] | None:
    try:
        if "://" in raw:
            parsed = urlsplit(raw)
            if parsed.scheme not in ("https", "http", "ssh") or not parsed.hostname:
                return None
            host = parsed.hostname.lower()
            # SSH ports address Git, not the provider's HTTPS API.
            if parsed.port and parsed.scheme != "ssh":
                host += ":" + str(parsed.port)
            path = parsed.path.lstrip("/")
        else:
            match = re.fullmatch(r"(?:[^@/\s]+@)?([A-Za-z0-9.-]+):(.+)", raw)
            if not match:
                return None
            host, path = match.group(1).lower(), match.group(2)
        path = path.rstrip("/").removesuffix(".git")
        if not re.fullmatch(r"[A-Za-z0-9.-]+(?::[0-9]+)?", host) or len(path.split("/")) < 2:
            return None
        if any(not re.fullmatch(r"[A-Za-z0-9_.-]+", part) or part in (".", "..") for part in path.split("/")):
            return None
        return host, path
    except ValueError:
        return None


def _review_dir(dir_: str) -> Path:
    d = _validate_dir(dir_)
    # Only a discovered immediate worktree is eligible; reject root/path symlink escapes.
    for candidate, _, _ in _task_worktrees():
        if (not candidate.is_symlink() and not (candidate / ".git").is_symlink() and candidate.resolve() == d
                and candidate.resolve().parent == candidate.parent.resolve()):
            return d
    raise HTTPException(403, "dir is not a discovered worktree")


def _review_source(d: Path) -> tuple[str, str, str]:
    branch = _run(["git", "branch", "--show-current"], d)
    if not branch:
        raise HTTPException(409, "code review requires a source branch (detached HEAD)")
    remote = (_run(["git", "config", "--get", f"branch.{branch}.pushRemote"], d)
              or _run(["git", "config", "--get", "remote.pushDefault"], d)
              or _run(["git", "config", "--get", f"branch.{branch}.remote"], d) or "origin")
    source = _review_remote(_run(["git", "remote", "get-url", "--push", "--", remote], d))
    if not source:
        raise HTTPException(409, "code review requires a supported repository remote format")
    return source[0], source[1], branch


def _review_url(url: str) -> str:
    try:
        p = urlsplit(url)
        if (p.scheme not in ("http", "https") or not p.hostname or p.username is not None or p.password is not None
                or any(c.isspace() or ord(c) < 32 for c in url) or "\\" in url):
            raise ValueError()
        p.port
    except (TypeError, ValueError):
        raise HTTPException(400, "review URL must be http(s) without credentials")
    return url


def _review_api(cli: str, host: str, endpoint: str, deadline: float) -> tuple[object, dict]:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(cli, _REVIEW_TIMEOUT)
    result = subprocess.run([cli, "api", "--hostname", host, "--method", "GET", "--include", endpoint],
                            capture_output=True, text=True, timeout=remaining, stdin=subprocess.DEVNULL)
    if result.returncode:
        # CLI diagnostics can contain URLs or credentials; never return them to clients.
        raise ValueError(f"{cli} query failed (exit {result.returncode}); check CLI login, permissions and host configuration")
    headers = {}
    body = result.stdout.replace("\r\n", "\n")
    if body.startswith("HTTP/"):
        header, body = body.split("\n\n", 1)
        headers = {k.strip().lower(): v.strip() for line in header.splitlines()[1:]
                   for k, sep, v in [line.partition(":")] if sep}
    return json.loads(body), headers


def _query_reviews(provider: str, host: str, repo: str, branch: str) -> dict:
    cli = "gh" if provider == "github" else "glab"
    deadline = time.monotonic() + _REVIEW_TIMEOUT
    reviews = {}
    try:
        project = None
        if provider == "gitlab":
            info, _ = _review_api(cli, host, "projects/" + quote(repo, safe=""), deadline)
            project = info["id"]
        for page in range(1, _REVIEW_MAX_PAGES + 1):
            params = {"state": "all", "per_page": 100, "page": page}
            if provider == "github":
                params["head"] = repo.split("/")[0] + ":" + branch
                endpoint = "repos/" + quote(repo, safe="/") + "/pulls"
            else:
                params.update({"scope": "all", "source_branch": branch})
                endpoint = "projects/" + quote(repo, safe="") + "/merge_requests"
            rows, headers = _review_api(cli, host, endpoint + "?" + urlencode(params), deadline)
            if not isinstance(rows, list):
                raise ValueError("provider returned an invalid review list")
            for row in rows:
                if provider == "github":
                    if row["head"]["ref"] != branch or (row["head"].get("repo") or {}).get("full_name", "").casefold() != repo.casefold():
                        continue
                    number, url, target = row["number"], row["html_url"], row["base"]["ref"]
                    state = "merged" if row.get("merged_at") else row["state"]
                else:
                    if row["source_branch"] != branch or row["source_project_id"] != project:
                        continue
                    number, url, target = row["iid"], row["web_url"], row["target_branch"]
                    state = "open" if row["state"] == "opened" else row["state"]
                url = _review_url(url)
                reviews[(provider, number)] = {"provider": provider, "number": number, "title": row["title"],
                    "url": url, "state": state, "draft": bool(row.get("draft") or row.get("work_in_progress")), "target_branch": target}
            if "x-next-page" in headers:
                more = bool(headers["x-next-page"])
            elif "link" in headers:
                more = 'rel="next"' in headers["link"]
            else:
                more = len(rows) >= 100
            if not more:
                break
        items = sorted(reviews.values(), key=lambda r: (-r["number"], r["provider"]))
        return {"status": "partial" if more else "ok" if items else "empty", "reviews": items,
                "message": "pagination limit reached; results are incomplete" if more else ""}
    except FileNotFoundError:
        return {"status": "unavailable", "reviews": [], "message": f"{cli} is not installed on the gateway"}
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "reviews": [], "message": f"review query timed out after {_REVIEW_TIMEOUT} seconds"}
    except (OSError, ValueError, KeyError, TypeError, HTTPException):
        return {"status": "error", "reviews": [], "message": f"{cli} query failed; check CLI login, permissions, host configuration and response format"}


def _manual_file() -> Path:
    return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser() / "cache/dev-board/review-links.json"


def _manual_read() -> dict:
    path = _manual_file()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        if not isinstance(data, dict) or any(not isinstance(v, list) or any(not isinstance(u, str) for u in v) for v in data.values()):
            raise ValueError()
        for urls in data.values():
            for url in urls:
                _review_url(url)
        return data
    except (OSError, ValueError, HTTPException):
        raise HTTPException(500, "cannot read manual review links")


@router.get("/reviews")
def review_links(dir: str = Query(...), force: bool = False) -> dict:
    d = _review_dir(dir)
    try:
        host, repo, branch = _review_source(d)
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        branch = _run(["git", "branch", "--show-current"], d)
        return {"status": "unsupported_source" if branch else "detached",
                "reviews": [], "manual": [], "branch": branch or None, "message": exc.detail}
    provider = _review_hosts().get(host)
    key = (provider, host, repo, branch)
    with _review_cache_lock:
        cached = _review_cache.get(key)
        result = cached[1] if cached and not force and time.monotonic() - cached[0] < _REVIEW_TTL else None
    if result is None:
        result = (_query_reviews(provider, host, repo, branch) if provider else
                  {"status": "unsupported", "reviews": [], "message": "host is not configured; manual links only"})
        with _review_cache_lock:
            now = time.monotonic()
            for old in [k for k, v in _review_cache.items() if now - v[0] >= _REVIEW_TTL]:
                del _review_cache[old]
            _review_cache[key] = (now, result)
            _review_cache.move_to_end(key)
            while len(_review_cache) > 256:
                _review_cache.popitem(last=False)
    with _manual_links_lock:
        manual = _manual_read().get(json.dumps([host + "/" + repo, branch]), [])
    return {**result, "repository": host + "/" + repo, "branch": branch, "manual": manual}


@router.post("/review_links")
def update_review_link(dir: str = Query(...), url: str = Query(...), action: str = Query(...)) -> dict:
    host, repo, branch = _review_source(_review_dir(dir))
    url = _review_url(url)
    if action not in ("add", "remove"):
        raise HTTPException(400, "action must be add or remove")
    key = json.dumps([host + "/" + repo, branch])
    with _manual_links_lock:
        data = _manual_read()
        urls = set(data.get(key, []))
        urls.add(url) if action == "add" else urls.discard(url)
        if urls:
            data[key] = sorted(urls)
        else:
            data.pop(key, None)
        path = _manual_file()
        temporary = None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".review-links-", delete=False) as stream:
                temporary = stream.name
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        except OSError:
            raise HTTPException(500, "cannot save manual review links")
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
    return {"ok": True}


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
        return out.stdout.rstrip("\r\n") if out.returncode == 0 else ""
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


def _editor_name() -> str:
    editor = os.environ.get("DEV_BOARD_EDITOR")
    if not editor or editor == "Visual Studio Code":
        return "VS Code"
    if editor.endswith(".app"):
        name = Path(editor).stem
        return "VS Code" if name == "Visual Studio Code" else name
    try:
        command = shlex.split(editor)
    except ValueError:
        return "配置的编辑器"
    name = Path(command[0]).name.removesuffix(".app") if command else "配置的编辑器"
    return "VS Code" if name in ("code", "Visual Studio Code") else name


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
    return {"api_version": API_VERSION, "tasks": [{"id": k, "repos": v} for k, v in sorted(tasks.items(), reverse=True)], "editor_name": _editor_name()}


def _model_config(raw) -> dict:
    try:
        config = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return config if isinstance(config, dict) else {}


@router.get("/zt_sessions")
def task_sessions() -> dict:
    """Task number -> sessions whose title carries a matching id, across profile stores."""
    import sqlite3

    out: dict[str, list] = {}
    for db in _session_dbs():
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            con.row_factory = sqlite3.Row
            rows = list(con.execute("select id, title, source, model_config, parent_session_id, end_reason,"
                                    " hidden, archived from sessions order by last_activity_at desc"))
            con.close()
            by_id = {row["id"]: row for row in rows}
            profile = db.parent.name if db.parent.parent.name == "profiles" else "default"
            lineages = {}
            for row in rows:
                if row["hidden"] or row["archived"] or row["source"] == "subagent":
                    continue
                config = _model_config(row["model_config"])
                if config.get("_delegate_from") or re.match(r"^\s*Subagent\s*:", row["title"] or "", re.I):
                    continue
                chain = [row]
                child = row
                while child["parent_session_id"] in by_id:
                    parent = by_id[child["parent_session_id"]]
                    config = _model_config(child["model_config"])
                    if (parent["end_reason"] != "compression" or child["source"] == "tool" or parent["id"] in {r["id"] for r in chain}
                            or any(config.get(k) == parent["id"] for k in ("_branched_from", "_delegate_from", "_reset_from"))):
                        break
                    chain.append(parent)
                    child = parent
                title = next((r["title"] for r in chain if r["title"]), "")
                m = _TITLE_RE.search(title or "")
                if not m:
                    continue
                full = m.group(1)
                num = re.search(r"(\d+)$", full)
                if num:
                    root = chain[-1]["id"]
                    entry = {"id": row["id"], "title": title, "label": full, "profile": profile,
                             "session_ids": [r["id"] for r in chain]}
                    if root not in lineages or len(chain) > len(lineages[root][1]["session_ids"]):
                        lineages[root] = (num.group(1), entry)
            for num, entry in lineages.values():
                out.setdefault(num, []).append(entry)
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


@router.post("/open_editor")
def open_editor(task: str = Query(...)) -> dict:
    """Open all of a task's worktrees in the editor as a multi-root window."""
    dirs = [d for d, zt, _ in _task_worktrees() if zt == task]
    if not dirs:
        raise HTTPException(status_code=404, detail="no worktrees for task")
    try:
        home = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()
        cache = home / "cache" / "dev-board" / "workspaces"
        cache.mkdir(parents=True, exist_ok=True)
        labels = sorted({s["label"] for s in task_sessions()["zt_sessions"].get(task, [])
                         if s.get("label", "").endswith("-" + task)})
        prefix = labels[0][:-len(task) - 1] if labels else "Task"
        # Encode each component separately so prefix/task boundaries stay unambiguous.
        prefix = quote(prefix, safe="").replace("-", "%2D")
        identity = quote(task, safe="").replace("-", "%2D")
        workspace = cache / (prefix + "-" + identity + ".code-workspace")
        workspace.write_text(json.dumps({"folders": [{"name": d.name, "path": str(d.resolve())} for d in dirs]}, indent=2) + "\n")
        targets = [str(workspace)]
        editor = os.environ.get("DEV_BOARD_EDITOR") or ("Visual Studio Code" if sys.platform == "darwin" else "code")
        cmd = shlex.split(editor)
        if sys.platform == "darwin" and (editor == "Visual Studio Code" or editor.endswith(".app")
                                         or len(cmd) == 1 and not shutil.which(cmd[0])):
            cmd = ["open", "-a", cmd[0] if len(cmd) == 1 else editor]
        cmd += targets
        subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=15)
        return {"ok": True, "opened": targets, "editor_name": _editor_name()}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="editor command timed out after 15 seconds")
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=500, detail=(exc.stderr or exc.stdout or f"editor exited with code {exc.returncode}").strip())
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=str(exc))
