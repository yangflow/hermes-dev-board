"""Independent task list API and storage."""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException

router = APIRouter()
API_VERSION = 3  # Bump when the API contract changes.


def _task_url(url: str) -> str:
    try:
        p = urlsplit(url)
        if (p.scheme not in ("http", "https") or not p.hostname or p.username is not None or p.password is not None
                or any(c.isspace() or ord(c) < 32 for c in url) or "\\" in url):
            raise ValueError()
        p.port
    except (TypeError, ValueError):
        raise HTTPException(400, "task URL must be http(s) without credentials")
    return url


LABEL_COLORS = ("red", "orange", "amber", "green", "teal", "blue", "violet", "gray")


DEFAULT_STATUSES = [
    {"id": "todo", "name": "待办", "color": "gray", "category": "todo"},
    {"id": "doing", "name": "进行中", "color": "blue", "category": "doing"},
    {"id": "done", "name": "已完成", "color": "green", "category": "done"},
]


def _statuses(value):
    if not isinstance(value, list) or not value:
        raise HTTPException(400, "statuses must be a non-empty ordered list")
    result, ids = [], set()
    for item in value:
        if (not isinstance(item, dict) or set(item) != {"id", "name", "color", "category"}
                or not isinstance(item["id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]+", item["id"])
                or item["id"] in ids or item["category"] not in ("todo", "doing", "done")):
            raise HTTPException(400, "invalid or duplicate status ID/category")
        ids.add(item["id"])
        result.append({**item, "name": _label_name(item["name"]), "color": _label_color(item["color"])})
    if {item["category"] for item in result} != {"todo", "doing", "done"}:
        raise HTTPException(400, "at least one status in each category is required")
    return result


def _label_name(name) -> str:
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 40 or any(ord(c) < 32 for c in name):
        raise HTTPException(400, "label name must be a non-empty string of at most 40 characters")
    return name.strip()


def _label_color(color) -> str:
    if color not in LABEL_COLORS:
        raise HTTPException(400, "label color must be one of: " + ", ".join(LABEL_COLORS))
    return color


def _task_labels(labels) -> list[str]:
    if not isinstance(labels, list):
        raise HTTPException(400, "labels must be a list of strings")
    return list(dict.fromkeys(_label_name(name) for name in labels))


def _check_labels(data, fields):
    if any(name not in data["labels"] for name in fields.get("labels", [])):
        raise HTTPException(400, "unknown label; create the label definition first")


_tasks_lock = threading.Lock()


def _tasks_file() -> Path:
    return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser() / "task-board/tasks.json"


def _tasks_read() -> dict:
    try:
        path = _tasks_file()
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("tasks"), list) or not isinstance(data.get("next_id"), int):
            raise ValueError()
        definitions = data.setdefault("labels", {})
        if not isinstance(definitions, dict):
            raise ValueError()
        for name, color in definitions.items():
            if _label_name(name) != name:
                raise ValueError()
            _label_color(color)
        data["statuses"] = _statuses(data.get("statuses", DEFAULT_STATUSES))
        ids = []
        for index, task in enumerate(data["tasks"]):
            if (not isinstance(task, dict) or not isinstance(task.get("id"), str) or not task["id"].isdigit()
                    or task.get("order") != index or not all(isinstance(task.get(k), str) for k in ("created_at", "updated_at"))
                    or not {"title", "ref", "note", "url", "status", "pinned"} <= task.keys()):
                raise ValueError()
            _task_fields({k: v for k, v in task.items() if k not in ("id", "order", "created_at", "updated_at")}, data["statuses"])
            task["labels"] = _task_labels(task.get("labels", []))
            _check_labels(data, task)
            ids.append(int(task["id"]))
        if len(set(ids)) != len(ids) or data["next_id"] <= max(ids, default=9):
            raise ValueError()
        return data
    except FileNotFoundError:
        return {"next_id": 10, "tasks": [], "labels": {}, "statuses": [dict(s) for s in DEFAULT_STATUSES]}
    except (OSError, ValueError, HTTPException):
        raise HTTPException(500, "cannot read tasks.json")


def _tasks_write(data: dict) -> None:
    path = _tasks_file()
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".tasks-", delete=False) as stream:
            temporary = stream.name
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except OSError:
        raise HTTPException(500, "cannot save tasks.json")
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def _task_fields(body: dict, statuses) -> dict:
    strings = {"title", "ref", "note", "url", "session_id", "session_profile", "session_title"}
    if set(body) - strings - {"status", "pinned", "labels"}:
        raise HTTPException(400, "unknown task field")
    if any(not isinstance(value, str) for key, value in body.items() if key in strings):
        raise HTTPException(400, "task text fields must be strings")
    if "title" in body and not body["title"].strip():
        raise HTTPException(400, "title is required")
    if "status" in body and body["status"] not in [s["id"] for s in statuses]:
        raise HTTPException(400, "invalid task status")
    if "pinned" in body and not isinstance(body["pinned"], bool):
        raise HTTPException(400, "pinned must be boolean")
    if body.get("url"):
        _task_url(body["url"])
    if "labels" in body:
        body = {**body, "labels": _task_labels(body["labels"])}
    return {**body, **({"title": body["title"].strip()} if "title" in body else {})}


def _task_find(data: dict, task_id: str) -> dict:
    for task in data["tasks"]:
        if task["id"] == task_id:
            return task
    raise HTTPException(404, "task not found")


@router.get("/tasks")
def list_tasks() -> dict:
    with _tasks_lock:
        data = _tasks_read()
        return {"api_version": API_VERSION, "tasks": data["tasks"], "statuses": data["statuses"]}


@router.post("/tasks")
def create_task(body: dict) -> dict:
    with _tasks_lock:
        data = _tasks_read()
        fields = _task_fields(body, data["statuses"])
        if "title" not in fields:
            raise HTTPException(400, "title is required")
        _check_labels(data, fields)
        now = datetime.now(timezone.utc).isoformat()
        task = {"id": str(data["next_id"]), "title": fields.pop("title"), "ref": "", "note": "", "url": "",
                "status": next(s["id"] for s in data["statuses"] if s["category"] == "todo"), "pinned": False, "labels": [], "order": len(data["tasks"]), "created_at": now, "updated_at": now, **fields}
        data["next_id"] += 1
        data["tasks"].append(task)
        _tasks_write(data)
        return task


@router.patch("/tasks/{task_id}")
def edit_task(task_id: str, body: dict) -> dict:
    with _tasks_lock:
        data = _tasks_read()
        fields = _task_fields(body, data["statuses"])
        task = _task_find(data, task_id)
        _check_labels(data, fields)
        task.update(fields, updated_at=datetime.now(timezone.utc).isoformat())
        _tasks_write(data)
        return task


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str) -> dict:
    with _tasks_lock:
        data = _tasks_read()
        data["tasks"].remove(_task_find(data, task_id))
        now = datetime.now(timezone.utc).isoformat()
        for index, task in enumerate(data["tasks"]):
            if task["order"] != index:
                task.update(order=index, updated_at=now)
        _tasks_write(data)
        return {"ok": True}


@router.post("/tasks/{task_id}/reorder")
def reorder_task(task_id: str, body: dict) -> dict:
    relative = set(body) == {"target_id", "placement"}
    if relative:
        if not isinstance(body["target_id"], str) or not body["target_id"].isdigit() or body["placement"] not in ("before", "after"):
            raise HTTPException(400, "target_id and placement before or after are required")
    elif body not in ({"direction": "up"}, {"direction": "down"}):
        raise HTTPException(400, "direction must be up or down, or supply target_id and placement")
    with _tasks_lock:
        data = _tasks_read()
        task = _task_find(data, task_id)
        group = [t for t in data["tasks"] if t["pinned"] == task["pinned"] and t["status"] == task["status"]]
        index = group.index(task)
        if relative:
            other = _task_find(data, body["target_id"])
            if other["status"] != task["status"] or other["pinned"] != task["pinned"]:
                raise HTTPException(400, "tasks must have the same status and pinned segment")
            if other == task:
                return {"tasks": data["tasks"]}
            group.remove(task)
            target = group.index(other) + (body["placement"] == "after")
            group.insert(target, task)
        else:
            target = index + (-1 if body["direction"] == "up" else 1)
            if 0 <= target < len(group):
                group[index], group[target] = group[target], group[index]
        now = datetime.now(timezone.utc).isoformat()
        reordered = iter(group)
        for index, current in enumerate(data["tasks"]):
            if current["status"] == task["status"] and current["pinned"] == task["pinned"]:
                replacement = next(reordered)
                if replacement is not current:
                    replacement["updated_at"] = now
                data["tasks"][index] = replacement
        for index, task in enumerate(data["tasks"]):
            task["order"] = index
        _tasks_write(data)
        return {"tasks": data["tasks"]}


@router.get("/labels")
def list_labels() -> dict:
    with _tasks_lock:
        return {"labels": _tasks_read()["labels"]}


@router.post("/labels")
def create_label(body: dict) -> dict:
    if set(body) != {"name", "color"}:
        raise HTTPException(400, "label requires name and color")
    name, color = _label_name(body["name"]), _label_color(body["color"])
    with _tasks_lock:
        data = _tasks_read()
        if name in data["labels"]:
            raise HTTPException(400, "label already exists")
        data["labels"][name] = color
        _tasks_write(data)
        return {"labels": data["labels"]}


@router.patch("/labels")
def edit_label(body: dict) -> dict:
    if "name" not in body or set(body) - {"name", "new_name", "color"}:
        raise HTTPException(400, "label update accepts name, new_name and color")
    name = _label_name(body["name"])
    new_name = _label_name(body.get("new_name", name))
    with _tasks_lock:
        data = _tasks_read()
        if name not in data["labels"]:
            raise HTTPException(404, "label not found")
        color = _label_color(body.get("color", data["labels"][name]))
        if new_name != name and new_name in data["labels"]:
            raise HTTPException(400, "label already exists")
        del data["labels"][name]
        data["labels"][new_name] = color
        if new_name != name:
            for task in data["tasks"]:
                if name in task["labels"]:
                    task.update(labels=[new_name if label == name else label for label in task["labels"]],
                                updated_at=datetime.now(timezone.utc).isoformat())
        _tasks_write(data)
        return {"labels": data["labels"]}


@router.delete("/labels")
def delete_label(name: str) -> dict:
    name = _label_name(name)
    with _tasks_lock:
        data = _tasks_read()
        if name not in data["labels"]:
            raise HTTPException(404, "label not found")
        del data["labels"][name]
        for task in data["tasks"]:
            if name in task["labels"]:
                task.update(labels=[label for label in task["labels"] if label != name],
                            updated_at=datetime.now(timezone.utc).isoformat())
        _tasks_write(data)
        return {"labels": data["labels"]}


@router.get("/statuses")
def list_statuses():
    with _tasks_lock:
        return {"statuses": _tasks_read()["statuses"]}


@router.put("/statuses")
def replace_statuses(body: dict):
    if set(body) - {"statuses", "migrations"} or "statuses" not in body:
        raise HTTPException(400, "statuses and migrations required")
    statuses = _statuses(body["statuses"])
    migrations = body.get("migrations", {})
    with _tasks_lock:
        data = _tasks_read()
        surviving = {s["id"] for s in statuses}
        removed = {s["id"] for s in data["statuses"]} - surviving
        if (not isinstance(migrations, dict) or any(k not in removed or not isinstance(v, str) or v not in surviving for k, v in migrations.items())):
            raise HTTPException(400, "migration must map removed statuses to surviving statuses")
        if any(t["status"] in removed and t["status"] not in migrations for t in data["tasks"]):
            raise HTTPException(400, "used status requires an explicit migration")
        for task in data["tasks"]:
            if task["status"] in removed:
                task["status"] = migrations[task["status"]]
        data["statuses"] = statuses
        _tasks_write(data)
        return {"statuses": statuses}


_sync_lock = threading.Lock()
_sync_running = False
_sync_last_result = None


def _sync_script():
    try:
        settings = json.loads((_tasks_file().parent / "settings.json").read_text(encoding="utf-8"))
        script = settings.get("sync_script")
        if isinstance(script, str) and Path(script).is_absolute() and Path(script).suffix == ".py" and Path(script).is_file():
            return script
    except (OSError, ValueError, AttributeError):
        pass
    return None


def _run_sync(script):
    global _sync_running, _sync_last_result
    result = {"started_at": datetime.now(timezone.utc).isoformat(), "ok": False}
    process = None
    try:
        # File-backed output avoids unbounded memory use; raw output is never exposed.
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen([sys.executable, script], stdout=output, stderr=subprocess.DEVNULL, start_new_session=True)
            try:
                code = process.wait(timeout=180)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                result["message"] = "Sync timed out (180s)"
            else:
                result["ok"] = code == 0
                result["message"] = "Sync completed" if code == 0 else "Sync failed (exit %s)" % code
                output.seek(0)
                try:
                    summary = json.loads(output.read(65536))
                    for key in ("created", "updated", "skipped", "failed", "total"):
                        value = summary.get(key)
                        if type(value) is int and 0 <= value <= 1000000000:
                            result[key] = value
                    exits = summary.get("stage_exits")
                    if isinstance(exits, list) and len(exits) <= 100 and all(type(code) is int and -255 <= code <= 255 for code in exits):
                        result["stage_exits"] = exits
                except (ValueError, AttributeError):
                    pass
    except Exception:
        result["message"] = "Unable to run sync adapter"
    finally:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        result["finished_at"] = datetime.now(timezone.utc).isoformat()
        with _sync_lock:
            _sync_last_result = result
            _sync_running = False


@router.get("/sync")
def sync_state():
    with _sync_lock:
        return {"available": bool(_sync_script()), "running": _sync_running, "last_result": _sync_last_result}


@router.post("/sync")
def start_sync(body: dict = {}):
    global _sync_running
    if body:
        raise HTTPException(400, "sync accepts no command or options")
    with _sync_lock:
        script = _sync_script()
        if not script:
            raise HTTPException(400, "sync adapter is not configured")
        if not _sync_running:
            _sync_running = True
            try:
                threading.Thread(target=_run_sync, args=(script,), daemon=True).start()
            except Exception:
                _sync_running = False
                raise HTTPException(500, "Unable to start sync")
        return {"available": True, "running": True, "last_result": _sync_last_result}
