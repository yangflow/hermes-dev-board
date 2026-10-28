"""Independent task list API and storage."""
from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException

router = APIRouter()
API_VERSION = 1  # Bump when backend routes change.


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
        ids = []
        for index, task in enumerate(data["tasks"]):
            if (not isinstance(task, dict) or not isinstance(task.get("id"), str) or not task["id"].isdigit()
                    or task.get("order") != index or not all(isinstance(task.get(k), str) for k in ("created_at", "updated_at"))
                    or not {"title", "ref", "note", "url", "status", "pinned"} <= task.keys()):
                raise ValueError()
            _task_fields({k: v for k, v in task.items() if k not in ("id", "order", "created_at", "updated_at")})
            task["labels"] = _task_labels(task.get("labels", []))
            _check_labels(data, task)
            ids.append(int(task["id"]))
        if len(set(ids)) != len(ids) or data["next_id"] <= max(ids, default=9):
            raise ValueError()
        return data
    except FileNotFoundError:
        return {"next_id": 10, "tasks": [], "labels": {}}
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


def _task_fields(body: dict) -> dict:
    strings = {"title", "ref", "note", "url", "session_id", "session_profile", "session_title"}
    if set(body) - strings - {"status", "pinned", "labels"}:
        raise HTTPException(400, "unknown task field")
    if any(not isinstance(value, str) for key, value in body.items() if key in strings):
        raise HTTPException(400, "task text fields must be strings")
    if "title" in body and not body["title"].strip():
        raise HTTPException(400, "title is required")
    if "status" in body and body["status"] not in ("todo", "doing", "done"):
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
        return {"api_version": API_VERSION, "tasks": _tasks_read()["tasks"]}


@router.post("/tasks")
def create_task(body: dict) -> dict:
    fields = _task_fields(body)
    if "title" not in fields:
        raise HTTPException(400, "title is required")
    with _tasks_lock:
        data = _tasks_read()
        _check_labels(data, fields)
        now = datetime.now(timezone.utc).isoformat()
        task = {"id": str(data["next_id"]), "title": fields.pop("title"), "ref": "", "note": "", "url": "",
                "status": "todo", "pinned": False, "labels": [], "order": len(data["tasks"]), "created_at": now, "updated_at": now, **fields}
        data["next_id"] += 1
        data["tasks"].append(task)
        _tasks_write(data)
        return task


@router.patch("/tasks/{task_id}")
def edit_task(task_id: str, body: dict) -> dict:
    fields = _task_fields(body)
    with _tasks_lock:
        data = _tasks_read()
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
    if body not in ({"direction": "up"}, {"direction": "down"}):
        raise HTTPException(400, "direction must be up or down")
    with _tasks_lock:
        data = _tasks_read()
        task = _task_find(data, task_id)
        group = [t for t in data["tasks"] if t["pinned"] == task["pinned"] and t["status"] == task["status"]]
        index = group.index(task)
        target = index + (-1 if body["direction"] == "up" else 1)
        if 0 <= target < len(group):
            other = group[target]
            a, b = data["tasks"].index(task), data["tasks"].index(other)
            data["tasks"][a], data["tasks"][b] = other, task
            now = datetime.now(timezone.utc).isoformat()
            task["updated_at"] = other["updated_at"] = now
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
