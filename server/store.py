"""Project storage for browser-started research projects.

Each project is a self-contained folder under projects/<safe-id>/ with its own
metadata, sources/, runs/, findings/, reports/, state/ and logs/ subfolders —
mirroring the existing top-level layout CLAUDE.md and research.md already use,
so the coordinator's usual relative-path conventions keep working unmodified
once told to root them at this folder (see runner.py's prompt preamble).

Legacy top-level runs/, findings/, reports/ are never read or written here.
"""
import json
import os
import re
import time
import uuid
from pathlib import Path

# Lowercase slug: starts alnum, then alnum/hyphen, max 63 chars. Deliberately
# stricter than check_citations.py's SAFE pattern (which also allows
# underscores/uppercase) since this id becomes a directory name we build once,
# server-side, and never accept verbatim from the client.
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")

MAX_TITLE_LEN = 200
MAX_TEXT_LEN = 20000          # generous ceiling for a single prompt/scope field
MAX_TASKS = 40
MAX_TASK_LEN = 2000
MAX_FILES = 50
MAX_FILENAME_LEN = 300
MAX_CLARIFICATION_LEN = 8000


class ValidationError(ValueError):
    """A client-supplied project field failed validation."""


PROJECT_SLUG_LEN = 36  # leaves room for -YYYYMMDD-HHMMSS-xxxxxx within SAFE_ID's 63 chars


def slugify(text, fallback="research"):
    s = (text or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = s[:PROJECT_SLUG_LEN].strip("-")
    return s or fallback


def new_project_id(title):
    """Server-generated, collision-resistant, filesystem-safe project id.
    Never derived from client-controlled data alone — always includes a
    timestamp + random suffix so a client cannot predict or collide paths."""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    suffix = uuid.uuid4().hex[:6]
    pid = f"{slugify(title)}-{stamp}-{suffix}"
    return pid if SAFE_ID.fullmatch(pid) else f"research-{stamp}-{suffix}"


def is_safe_id(pid):
    return isinstance(pid, str) and bool(SAFE_ID.fullmatch(pid))


def validate_clarification(text):
    """Clarification text the user types in the Needs attention screen. Must
    be non-empty after trimming and within a sane size — the same discipline
    as every other user-supplied text field in this module."""
    if not isinstance(text, str) or not text.strip():
        raise ValidationError("clarification text is required")
    text = text.strip()
    if len(text) > MAX_CLARIFICATION_LEN:
        raise ValidationError(f"clarification text is too long (max {MAX_CLARIFICATION_LEN} characters)")
    return text


class Store:
    def __init__(self, root: Path):
        self.root = root                      # repository root (cwd Claude runs from)
        self.projects_dir = root / "projects"
        self.projects_dir.mkdir(exist_ok=True)

    # ---- path helpers (all resolve-and-verify to block path traversal) ----
    def project_dir(self, pid):
        if not is_safe_id(pid):
            raise ValidationError("invalid project id")
        p = (self.projects_dir / pid).resolve()
        base = self.projects_dir.resolve()
        if base not in p.parents and p != base:
            raise ValidationError("invalid project id")
        return p

    def exists(self, pid):
        try:
            return self.project_dir(pid).is_dir()
        except ValidationError:
            return False

    # ---- safe removal ----
    def remove(self, pid, confirm_title):
        """Moves a project into projects/.trash/ rather than deleting it
        outright, so an accidental removal is recoverable. Requires the
        caller to have already re-typed the project's own title — checked
        here too, server-side, never trusted from the client alone. Never
        accepts an arbitrary filesystem path: `pid` goes through the same
        project_dir() traversal boundary as every other project operation."""
        pdir = self.project_dir(pid)
        if not pdir.is_dir():
            raise ValidationError("project not found")
        meta = self.read_meta(pid)
        if not meta:
            raise ValidationError("project not found")
        expected = (meta.get("title") or "").strip()
        if not isinstance(confirm_title, str) or confirm_title.strip() != expected:
            raise ValidationError("confirmation text does not match the project title")
        trash_dir = self.projects_dir / ".trash"
        trash_dir.mkdir(exist_ok=True)
        dest = trash_dir / f"{pid}-{uuid.uuid4().hex[:8]}"
        pdir.rename(dest)
        return str(dest.name)

    # ---- creation ----
    def create(self, payload):
        title = _require_str(payload.get("title"), "title", MAX_TITLE_LEN)
        question = _require_str(payload.get("question"), "question", MAX_TEXT_LEN)
        approach = payload.get("approach")
        if approach not in ("quick", "deep"):
            raise ValidationError("approach must be 'quick' or 'deep'")
        selected_prompt = _require_str(payload.get("selectedPrompt"), "selectedPrompt", MAX_TEXT_LEN)
        timeframe = _optional_str(payload.get("timeframe"), "timeframe", 200)
        depth = _optional_str(payload.get("depth"), "depth", 200)
        in_scope = _optional_str(payload.get("inScope"), "inScope", MAX_TEXT_LEN)
        out_scope = _optional_str(payload.get("outScope"), "outScope", MAX_TEXT_LEN)
        tasks = _string_list(payload.get("tasks"), "tasks", MAX_TASKS, MAX_TASK_LEN)
        context = payload.get("context") or {}
        answers = []
        for a in (context.get("answers") or [])[:MAX_TASKS]:
            if isinstance(a, dict):
                answers.append({
                    "q": _optional_str(a.get("q"), "answer question", 500),
                    "a": _optional_str(a.get("a"), "answer text", 2000),
                })
        files = _string_list(context.get("files"), "files", MAX_FILES, MAX_FILENAME_LEN)

        pid = new_project_id(title)
        pdir = self.project_dir(pid)
        pdir.mkdir(parents=True, exist_ok=False)
        for sub in ("sources", "runs", "findings", "reports", "state", "logs"):
            (pdir / sub).mkdir(exist_ok=True)

        if files:
            note = (
                "Document names recorded by the browser UI. Names only — no file content was\n"
                "uploaded or transmitted, and none is processed by this prototype.\n\n"
                + "\n".join(f"- {f}" for f in files) + "\n"
            )
            atomic_write(pdir / "sources" / "README.md", note)

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        meta = {
            "id": pid,
            "title": title,
            "question": question,
            "approach": approach,
            "selectedPrompt": selected_prompt,
            "timeframe": timeframe,
            "depth": depth,
            "inScope": in_scope,
            "outScope": out_scope,
            "tasks": tasks,
            "context": {"answers": answers, "files": files},
            "createdAt": now,
            "updatedAt": now,
        }
        atomic_write_json(pdir / "project.json", meta)
        atomic_write_json(pdir / "state" / "run.json", {
            "status": "ready",
            "phase": None,
            "sessionId": None,
            "mode": approach,
            "startedAt": None,
            "updatedAt": now,
            "stopReason": None,
            "error": None,
            "pid": None,
            "runId": None,
            "budgetContinuations": 0,
            "maxBudgetContinuations": 2,
        })
        return meta

    def read_meta(self, pid):
        pdir = self.project_dir(pid)
        p = pdir / "project.json"
        if not p.is_file():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def read_run_state(self, pid):
        pdir = self.project_dir(pid)
        p = pdir / "state" / "run.json"
        if not p.is_file():
            return {"status": "ready", "phase": None, "sessionId": None, "mode": None,
                     "stopReason": None, "error": None, "pid": None, "runId": None,
                     "budgetContinuations": 0, "maxBudgetContinuations": 2}
        return json.loads(p.read_text(encoding="utf-8"))

    def write_run_state(self, pid, state):
        pdir = self.project_dir(pid)
        state = dict(state)
        state["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        atomic_write_json(pdir / "state" / "run.json", state)

    def list_projects(self):
        out = []
        if not self.projects_dir.is_dir():
            return out
        for entry in sorted(self.projects_dir.iterdir()):
            if not entry.is_dir() or not is_safe_id(entry.name):
                continue
            meta = self.read_meta(entry.name)
            if not meta:
                continue
            state = self.read_run_state(entry.name)
            out.append(_summarize(meta, state))
        out.sort(key=lambda p: p.get("createdAt", ""), reverse=True)
        return out

    def project_detail(self, pid):
        meta = self.read_meta(pid)
        if not meta:
            return None
        state = self.read_run_state(pid)
        pdir = self.project_dir(pid)
        detail = _summarize(meta, state)
        detail["inScope"] = meta.get("inScope", "")
        detail["outScope"] = meta.get("outScope", "")
        detail["tasks"] = meta.get("tasks", [])
        detail["context"] = meta.get("context", {})
        detail["selectedPrompt"] = meta.get("selectedPrompt", "")

        run_id = state.get("runId")
        run_md_path = None
        if run_id and is_safe_id_loose(run_id):
            candidate = pdir / "runs" / run_id / "run.md"
            if candidate.is_file():
                run_md_path = candidate
        if run_md_path is None:
            # best-effort discovery: most recently modified runs/*/run.md
            candidates = sorted((pdir / "runs").glob("*/run.md"), key=lambda p: p.stat().st_mtime, reverse=True) \
                if (pdir / "runs").is_dir() else []
            if candidates:
                run_md_path = candidates[0]
                run_id = run_md_path.parent.name
        detail["runId"] = run_id
        detail["runMarkdown"] = _read_capped(run_md_path) if run_md_path else None

        report_path = None
        if run_id:
            candidate = pdir / "reports" / f"{run_id}.md"
            if candidate.is_file():
                report_path = candidate
        if report_path is None and (pdir / "reports").is_dir():
            candidates = sorted((pdir / "reports").glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
            if candidates:
                report_path = candidates[0]
        detail["reportMarkdown"] = _read_capped(report_path) if report_path else None

        activity_path = pdir / "state" / "activity.json"
        detail["activity"] = json.loads(activity_path.read_text(encoding="utf-8")) if activity_path.is_file() else []
        return detail


def is_safe_id_loose(s):
    # matches check_citations.py's SAFE pattern for run_id (allows underscore/uppercase)
    return isinstance(s, str) and bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", s))


def _summarize(meta, state):
    return {
        "id": meta["id"],
        "title": meta.get("title", ""),
        "question": meta.get("question", ""),
        "approach": meta.get("approach", ""),
        "timeframe": meta.get("timeframe", ""),
        "depth": meta.get("depth", ""),
        "createdAt": meta.get("createdAt", ""),
        "updatedAt": meta.get("updatedAt", ""),
        "status": state.get("status", "ready"),
        "phase": state.get("phase"),
        "stopReason": state.get("stopReason"),
        "error": state.get("error"),
        "sessionId": state.get("sessionId"),
        "citationCheck": state.get("citationCheck"),
        "budgetContinuations": state.get("budgetContinuations", 0),
        "maxBudgetContinuations": state.get("maxBudgetContinuations", 2),
    }


def _read_capped(path, cap=400_000):
    try:
        data = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    if len(data) > cap:
        data = data[:cap] + "\n\n…(truncated for display)"
    return data


def _require_str(v, name, max_len):
    if not isinstance(v, str) or not v.strip():
        raise ValidationError(f"{name} is required")
    v = v.strip()
    if len(v) > max_len:
        raise ValidationError(f"{name} is too long (max {max_len} characters)")
    return v


def _optional_str(v, name, max_len):
    if v is None:
        return ""
    if not isinstance(v, str):
        raise ValidationError(f"{name} must be a string")
    if len(v) > max_len:
        raise ValidationError(f"{name} is too long (max {max_len} characters)")
    return v


def _string_list(v, name, max_items, max_len):
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > max_items:
        raise ValidationError(f"{name} must be a list of at most {max_items} strings")
    out = []
    for item in v:
        if not isinstance(item, str):
            raise ValidationError(f"{name} entries must be strings")
        item = item.strip()
        if not item:
            continue
        if len(item) > max_len:
            raise ValidationError(f"{name} entry is too long (max {max_len} characters)")
        out.append(item)
    return out


def atomic_write(path: Path, text: str):
    """Write via a temporary sibling then atomic rename, per CLAUDE.md's
    crash-safety convention — never leaves a half-written file at `path`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = None, None
    try:
        import tempfile
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass
        raise


def atomic_write_json(path: Path, obj):
    atomic_write(path, json.dumps(obj, indent=2, ensure_ascii=False))
