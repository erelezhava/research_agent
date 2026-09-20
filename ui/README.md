# Deep Research — browser interface

A friendly front end for the research agent in this repository. It has two modes, chosen
automatically by whether a local backend is running:

- **Connected** (via `python3 start.py` or `bash ui/launch.sh`): approved briefs create real projects on disk and
  **Start research** launches the actual `/research` workflow through your own local Claude Code
  CLI. This is real research, not a simulation — it reads/writes files and can search the web,
  using your own Claude Code sign-in and allowance.
- **Standalone** (opening `ui/research.html` directly, no backend running): a design preview with
  fictional example content and browser-local drafts — nothing is sent anywhere. Every feature this
  mode had before still works exactly the same; connecting a backend only adds capability on top.

The app always tells you which mode you're in (the top banner and footer say so), and the
example/sample content stays clearly labeled as fictional in both modes.

## How to launch

### Connected: `bash ui/launch.sh` or `python3 start.py`

Two equivalent launchers start the exact same backend the exact same way — use whichever is more
convenient. `ui/launch.sh` is the original bash script; the repo root also has `start.py`, a
stdlib-only Python launcher that needs no shell and is the easier path for people less comfortable
with a terminal (see the root [README.md](../README.md)).

```bash
python3 start.py
```

On Linux/macOS, `bash ui/launch.sh` is an equivalent alternative.

This starts the local backend (`server/app.py`) bound to **127.0.0.1 only**, waits until it's
actually accepting connections, then opens your browser. Press `Ctrl+C` to stop. Pass a different
port as the first argument: `bash ui/launch.sh 9000`.

Requires **Python 3** (stdlib only — no packages to install) and, to actually start research,
Claude Code installed and signed in on this machine. The launcher and the app itself handle
common problems with clear messages rather than failing silently:

- **No Python 3** → tells you, and points you to opening `research.html` directly instead.
- **Invalid port** / **port already in use** → explains and suggests a fix.
- **Backend fails to start** → prints its own error output instead of opening a blank tab.
- **Claude Code not installed, or not signed in** → the launcher prints a note up front, and the
  app itself shows a clear message on the Start research screen rather than pretending research
  can begin.

### Standalone: open `ui/research.html` directly

Double-click it, or use your browser's File → Open. No backend, no Python needed. This is the
original design-preview experience — example content, browser-local drafts — completely
unaffected by anything below.

## What you can do

1. **Welcome** — what the app does, and (in connected mode) a note that it's using your local
   Claude Code.
2. **My research** — your real projects (connected mode) plus example projects, each with clear
   status; a *Start research* button.
3. **New research** — a four-step wizard: your question → optional follow-ups → **Research
   approach** (Quick vs. Deep, with an editable generated prompt — see below) → review/edit the
   brief. Approving it creates a real project when connected, or saves a browser-local draft
   otherwise.
4. **Research workspace** — in connected mode, a **Ready to start** screen showing the exact mode
   and prompt plus a clear statement that starting uses your Claude Code allowance; after
   starting, live status (not simulated), recent activity, and — once complete — the real report
   with a table of contents, headings, tables, and clickable citations.

## The "Research approach" step

Two side-by-side cards — **Quick research** and **Deep research** — each with a plain-language
explanation, an **editable research prompt**, and a summary of the expected depth/report style.
Quick is selected by default. The choice is stored as a stable machine value (`quick`/`deep`) plus
the full selected prompt; in connected mode this is exactly what's passed to the real workflow —
your prose question is never re-interpreted to guess the mode. Editing a prompt is preserved:
going back to change an earlier answer only regenerates the prompt(s) you didn't touch.

**Local generation vs. Claude-powered improvement.** The two prompts are written entirely **on
your device** from a simple built-in template — no Claude call, no internet request, in either
mode. A future version could use Claude to improve their wording; that is not implemented here.

The step deliberately never promises a duration, cost, or number of searches, because those can't
be guaranteed.

## Connected mode: what actually happens

### The exact Claude Code invocation

```
claude -p "<instructions + mode + your approved prompt, verbatim>" \
  --model sonnet \
  --output-format stream-json --verbose \
  --tools Read,Write,Edit,Grep,Glob,WebSearch,WebFetch,Task \
  --allowedTools Read,Write,Edit,Grep,Glob,WebSearch,WebFetch,Task \
  --permission-mode acceptEdits \
  --permission-prompts none \
  --strict-mcp-config \
  --setting-sources project \
  --session-id <generated-uuid>          # or --resume <uuid> for Resume/Clarify/Repair
```

`--model` defaults to `sonnet` and can be overridden when the backend is launched (`--model` on
`ui/launch.sh`'s underlying `python3 -m server.app` or on `start.py`); whatever value is actually
configured is validated (`^[A-Za-z0-9_.:-]{1,80}$`) and exposed through `/api/health` so the browser
can show the real value on the Ready-to-start screen — it is never a guess or a hardcoded label that
could drift from what's actually running.

**Bash is not in `--tools`.** An earlier version of this backend included Bash (so the session could
run the citation checker itself) plus a `--disallowedTools "Bash(rm *)" ...` blacklist meant to keep
it safe. That blacklist approach was removed: a denylist of dangerous subcommands is inherently
incomplete, and unattended non-interactive sessions are exactly the case where a missed pattern has
no human in the loop to catch it. Browser-started sessions now have **no Bash tool at all** — the
citation checker instead runs as a separate, independent local Python process the backend starts
itself after the session ends (see "What happens on…" below). Terminal `/research` sessions (where
you're present and Bash is already available in your own Claude Code session) are unaffected and can
still run the checker themselves — see `.claude/commands/research.md`, which now branches on whether
Bash is available.

Run from the repository root with `cwd` set there (not inside `projects/<id>/`), so
`.claude/agents/`, `.claude/commands/research.md` and `CLAUDE.md` are auto-discovered exactly as
in an interactive session. The prompt tells Claude explicitly to follow
`.claude/commands/research.md` — it does **not** rely on `/research` slash-command expansion,
which is unverified in non-interactive mode — and to root every path
(`runs/`, `findings/`, `reports/`, `sources/`) under that project's own `projects/<id>/` folder
instead of the repository root. The `mode: quick |` / `mode: deep |` prefix and your exact
approved prompt text are reproduced **verbatim as data**: shell metacharacters in it cannot
execute anything, because the whole string is one argv element passed directly to `exec`, never
built into or interpreted by a shell (see Security below).

Every flag above was **verified empirically** against the installed CLI (2.1.278) rather than
assumed — worth knowing since some of it is genuinely non-obvious:

- `--allowedTools` does **not** restrict tool availability in `-p` mode on this version — it
  pre-approves the named tools. The hard availability boundary is `--tools`, confirmed by asking
  the model to enumerate its own granted tools with each flag combination. Both flags are present:
  the same narrow list is available and pre-approved, so WebSearch/WebFetch work without an
  interactive approval window while Bash and unrelated tools remain unavailable.
- Without `--strict-mcp-config`, unrelated account-level MCP connectors (Gmail, Drive, Spotify,
  Docs, in this Anthropic environment) leaked into the toolset even under a tight `--tools`
  allowlist. `--strict-mcp-config` with no `--mcp-config` removed all of them.
- A brand-new, never-interactively-trusted working directory (any fresh `projects/<id>/`) denies
  Write by default. `--permission-mode acceptEdits` is required for unattended file writes to work
  at all; `--permission-mode bypassPermissions` (equivalent to `--dangerously-skip-permissions`)
  is never used.
- `--session-id <uuid>` is honored verbatim, and `--resume <uuid>` reliably reconnects with full
  memory — verified with a round-trip secret-word test across two separate invocations. Resume is
  now used for three separate flows: **Resume** after an interruption, **Continue research** after
  answering a Needs-attention clarification, and the citation-repair follow-up (see below).

### Authentication and permissions

Claude Code uses **your own existing sign-in** (`claude auth login`, the same one your terminal
uses) — this app never asks for or stores an API key, and it never sets `ANTHROPIC_API_KEY`. The
backend checks `claude auth status` before allowing Start; if you're not signed in, it says so
plainly instead of trying anyway.

The tool set above (Read/Write/Edit/Grep/Glob/WebSearch/WebFetch/Task, **no Bash**) is the smallest
set that still lets the actual workflow read/write its own project files and delegate to
`.claude/agents/`'s subagents — verified to be necessary and sufficient, not a guess. If a future CLI
version can't reproduce this safely, the right response is the Needs attention state described
below, not a weaker permission mode.

### What happens on…

- **A clarifying question the model would normally ask you**: with nobody able to answer a
  permission or input prompt live, the run either proceeds (for things this configuration already
  allows) or is cleanly denied (for anything outside the granted tools) — nothing hangs waiting for a
  human mid-tool-call. If the coordinator genuinely needs your input before it can produce a report,
  it stops and saves that in `run.md`; the project shows as **Needs attention**, and the workspace
  shows the run's own saved notes **plus an in-browser "Add clarification" textarea and Continue
  research button** — you answer directly in the browser rather than starting a new project. See
  "Answering Needs-attention from the browser" below.
- **A permission denial** (something outside the granted tools): recorded and the run continues past
  it rather than crashing; if that denial prevents a report from being written at all, the project
  ends up **Needs attention** or **Failed** depending on how the run concluded.
- **Evidence access is blocked for the whole run**: a saved failure explanation is not labeled as a
  completed report. The project shows **Needs attention**, preserves the session and plan, and
  offers **Resume research** after the access problem is fixed. Older projects falsely labeled
  Completed are reconciled from their saved stop reason when reopened.
- **A citation-check failure**: the backend's own independent `scripts/check_citations.py` process
  (not the Claude session — it has no Bash) runs after the session ends. If it finds a structural
  problem, the project shows **Completed with warnings** instead of plain **Completed** — the report
  is still shown in full, with the checker's safe summary and a "Ask Claude to fix this" button that
  resumes the same session to repair the citation structure and lets the backend rerun the checker.
  See "Citation-check failures" below.
- **A citation check that is missing, times out, or cannot start**: the report also shows
  **Completed with warnings**, because it was not independently validated. It shows the safe reason
  but no repair button, since the checker did not find a specific report defect.
- **You click Stop** while a run is Starting or Researching: the backend sends the Claude process a
  graceful termination signal (`SIGTERM` to its process group on POSIX; `CTRL_BREAK_EVENT` then
  `taskkill /T /F` on Windows), waits a short grace period, and force-kills only if it hasn't exited.
  The project is marked **Interrupted — resumable**, preserving its session id, so **Resume** works
  afterward exactly like a usage-limit interruption. A narrow `/stop` endpoint checks the project id
  against the actual active run before terminating anything, so a stale request or a different,
  inactive project can never stop someone else's run.
- **A usage-limit or temporary connection interruption**: detected from the CLI's own result text
  (including the exact `session limit`/reset-time and `Can't reach the API server`/`EAI_AGAIN`
  messages observed in real runs) and shown as **Interrupted — resumable**, with a **Resume research**
  button that reconnects the same session via `--resume` — explicitly restating the project's path
  rooting rather than relying only on conversation memory, since CLAUDE.md itself warns that
  context compaction can lose the transcript. Older recoverable failures are repaired when opened;
  a genuinely failed run with a saved session still offers a **Try resuming** fallback.
- **A crash** (of the `claude` process, or of the backend process itself): state lives on disk in
  `projects/<id>/state/run.json`, written atomically, so a server restart re-reads it rather than
  losing it. If the recorded process is confirmed dead and the run never reached a terminal state,
  it's treated honestly as no longer running rather than claimed as still in progress.
- **Malformed or unexpected CLI output**: unparseable lines are skipped for the activity feed
  (never shown raw) but always kept in the local log file; if no valid completion result was ever
  seen, the run ends in **Failed** with a generic, honest message rather than a guess.

### Browser workspace states

**Ready to start · Starting… · Researching · Needs attention · Completed · Completed with warnings
· Failed · Interrupted — resumable.** These come from the run's actual saved status
(`projects/<id>/state/run.json`) and current files on disk — never a simulated countdown. While
researching, the page polls the backend every ~2 seconds and shows the run's own saved notes
(`run.md`, rendered) plus a short activity feed of generic tool-use labels ("Reading a project
file", "Searching the web", …) — never the model's raw reasoning or full tool output. A **Stop**
button is shown throughout Starting/Researching. Only one research run can be active at a time
across the whole app; starting a second project while one is running is refused with a clear
message, and removing or stopping a project other than the active one is likewise refused.

### Stopping a run

The Researching (and Starting) screen shows a **Stop** button. It posts to `/stop` with the
project id; the backend verifies that id matches the currently active run (a stale click on a
project that already finished, or one that was never active, does nothing) before terminating the
Claude process and its process group. The project moves to **Interrupted — resumable** with its
session id preserved, so **Resume** continues the exact same conversation afterward — stopping is
not the same as abandoning the work done so far. On a graceful backend shutdown (`Ctrl+C` /
`SIGTERM`), the server stops any active Claude process the same way before exiting, so a clean
`Ctrl+C` never leaves an orphaned research process running in the background. A hard kill of the
backend (`kill -9`, a crashed terminal, an OS crash) does **not** go through this cleanup path —
whatever the operating system does with orphaned child processes in that case applies instead; this
app cannot intervene once its own process has been killed without a chance to run its shutdown
handler.

### Answering Needs-attention from the browser

When a project needs information from you, the workspace shows an **Add clarification** textarea and
**Continue research** button (only when the project has a resumable session id — otherwise a clear
fallback message explains there's nothing to resume and suggests starting a new project instead). A
validated `POST /clarify` endpoint accepts only the clarification text for that specific project,
rejects empty or oversized text (over 8000 characters) and unsafe project ids, and resumes the exact
same Claude session with your text wrapped in an explicit
`<<<USER_CLARIFICATION_BEGIN>>> ... <<<USER_CLARIFICATION_END>>>` delimiter that tells the model this
is user-supplied research **data**, not new instructions. All of the project's existing files, runs,
findings, and evidence are preserved — this resumes the same run, it does not start a new one.
When the reason is inaccessible evidence rather than a missing user detail, the same state instead
shows the blocked-run record and a **Resume research** button; it does not ask for irrelevant
clarification.

### Citation-check failures and repair

Plain **Completed** is used only when the backend's independent citation checker runs and passes.
If it finds a structural problem, the project shows **Completed with warnings**. The report itself
is still shown in full, along with the checker's safe summary (never a raw stack trace or absolute
path) and an **"Ask Claude to fix this"** button. That button calls `POST /repair-citations`, which
resumes the same session with the checker's output wrapped in a
`<<<CHECKER_OUTPUT_BEGIN>>> ... <<<CHECKER_OUTPUT_END>>>` data delimiter and asks it to repair the
structural issue; the backend then reruns the checker and updates the status accordingly. If the
checker is missing, times out, or cannot start, the same warning state is used but the repair button
is withheld: validation was inconclusive and there is no identified report defect for Claude to
repair.

### Removing a project

Each project's workspace has a **Remove** control, collapsed behind a confirmation step: you must
type the project's exact title to enable the confirm button, and removal is refused outright while
that project is the currently active run. `POST /remove` re-validates the project id through the
same safe-id boundary used everywhere else (`^[a-z0-9][a-z0-9-]{0,62}$`, resolved and checked
against the real `projects/` directory — no client-supplied filesystem path is ever accepted) and
then **moves** the project's folder into a local, git-ignored `projects/.trash/` folder rather than
deleting it, so an accidental removal is still recoverable by hand from disk. The confirmation UI
notes that the project's logs may contain your original question, sources, and Claude's output.

### Project storage

Each browser-started project gets its own folder:

```
projects/<safe-project-id>/
  project.json         # title, question, approach, selected prompt, scope, tasks
  sources/README.md    # document NAMES the user mentioned — never file content
  runs/<run_id>/run.md, verification.md
  findings/<run_id>/<task_id>.md, .json
  reports/<run_id>.md
  state/run.json        # status, phase, session id, stop reason — atomic writes
  logs/session-<id>.log # full local transcript (never served over HTTP)
```

This mirrors the top-level `runs/`/`findings/`/`reports/`/`sources/` layout the terminal workflow
already uses, so `scripts/check_citations.py` needed only one additive change (an optional
`--root` flag, defaulting to the current behavior) to validate either layout — existing tests and
existing top-level runs are untouched. `projects/` is git-ignored (only a `.gitkeep` placeholder is
tracked); nothing you create there is committed.

### Security boundaries this backend enforces

- Binds to **127.0.0.1 only**; every request's `Host` header is checked, and cross-origin
  state-changing requests (mismatched `Origin`) are rejected.
- Claude Code is launched as an **argv list**, never a shell string — a prompt containing shell
  metacharacters (`` ` ``, `$()`, `;`, quotes) is passed through as literal data and cannot execute
  anything. No endpoint accepts or runs arbitrary shell commands.
- `--dangerously-skip-permissions` / `--permission-mode bypassPermissions` are **never** used.
- The Claude process runs from the repository root so it can discover `CLAUDE.md`, commands, and
  agent definitions. Its Read/Write/Edit permissions therefore cover the repository as a whole;
  keeping research output inside `projects/<id>/` is enforced by the workflow instructions, not an
  operating-system per-project sandbox. Use this repository copy as a trusted research workspace
  and do not store unrelated sensitive files inside it.
- Project ids are always server-generated and validated (`^[a-z0-9][a-z0-9-]{0,62}$`) before ever
  touching a path; traversal attempts (`../..`, encoded slashes, etc.) are rejected before any
  filesystem access.
- Static files are served from a fixed allowlist under `ui/`; request bodies are size-capped.
- API responses never include environment variables, raw stack tracebacks, or absolute filesystem
  paths — errors are logged locally (console/log file) and given generic, actionable messages to
  the browser.
- State survives a server restart (see Project storage above); only one research run is active at
  a time, tracked by a lock file that self-heals if the server was killed mid-run.

## Standalone mode: saving (local to this browser)

Projects you approve and in-progress drafts are saved in this browser's **local storage** so they
survive a refresh. They are **not** written to disk as project folders, and they do not sync
between browsers or machines. If the browser blocks local storage (e.g. strict private mode), the
app still works for the visit but shows a notice that nothing can be saved. This is unchanged from
before connected mode existed.

## What is real vs. simulated

| Part | Status |
|------|--------|
| Main navigation, wizard, brief editing (both modes) | Functional |
| **Research approach** step: compare/edit two prompts, choose Quick or Deep | Functional |
| Local (on-device) prompt generation from a template | Functional |
| Claude-powered prompt *improvement* | Not implemented (future) |
| **Connected mode:** real project creation, Start research, live status, real report | Functional — uses your local Claude Code |
| **Connected mode:** Resume after an interruption | Functional (`--resume`, verified) |
| **Connected mode:** citation-checker confirmation on completion | Functional (defense in depth, non-blocking) |
| **Standalone mode:** browser-local drafts and projects (local storage) | Functional, unchanged |
| Table of contents, citation navigation, *Back to reading*, focus-reading toggle | Functional (both modes) |
| Selecting documents (either mode) | Names recorded only — **never uploaded, opened, or read** |
| Standalone example projects / sample report | Fictional, placeholder sources, clearly labeled |
| Standalone "needs attention" example questions | Display-only (that example project is fictional) |

## Files

- `research.html`, `styles.css`, `app.js`, `data.js` — the frontend (unchanged structure; `app.js`
  now includes an API client used only when connected).
- `launch.sh` — starts the local backend, loopback-only, with friendly error handling.
- `../start.py` — a stdlib-only, cross-platform alternative launcher at the repo root (see the root
  [README.md](../README.md) and [USER_GUIDE.md](../USER_GUIDE.md)); starts the same backend the same
  way and needs no shell script.
- `../server/app.py`, `store.py`, `runner.py` — the local backend: HTTP app, project storage
  (including safe removal-to-trash), and the verified Claude Code invocation and process lifecycle
  (start/stop/resume/clarify/repair — see Connected mode above).
- `../tests/test_server.py`, `../tests/test_start.py`, `../tests/fixtures/fake_claude.py` —
  automated tests using a fake `claude` executable; no real CLI or Claude allowance is used by the
  test suite.

## Verification

**Automated** (`python3 -B -m unittest discover -s tests -v`, all against a fake `claude` — zero
real Claude allowance consumed): mode (`quick`/`deep`) passed correctly; the approved prompt
preserved exactly, including special characters; shell metacharacters in a prompt proven inert (a
marker file is asserted never created); unsafe project ids and path-traversal attempts rejected;
only one run active at a time; successful completion exposes the report; a CLI failure produces a
clear Failed state; exact usage-limit and temporary internet/DNS/API failures produce Interrupted,
and Resume then
completes it; state survives a full server restart; the server binds loopback-only; cross-origin
POSTs are rejected; oversized request bodies are rejected; **Bash is confirmed absent from every
`--tools` invocation and no disallowed/bypass permission flags are ever passed**; **Stop** correctly
terminates a held run to Interrupted (with a real OS-level process kill, verified against a
genuinely long-held fake process), Resume then completes it, a different/inactive project cannot
stop the active run, and a graceful backend shutdown leaves no fake process running; the
**clarification** flow succeeds, rejects invalid/empty/oversized text and unsafe project ids, and
resumes the correct session; **citation-check** states are tested for passing, failing, unavailable,
and timed-out checks, producing Completed vs. Completed-with-warnings correctly, and the repair flow
resumes and re-checks; **model** validation accepts the default and valid overrides and rejects
invalid values; project **removal** rejects traversal attempts and an active project, requires the
matching confirmation title, and moves (never deletes) the folder into `projects/.trash/`; the root
`start.py` launcher is tested separately (readiness wait, exactly-once browser open, invalid port
rejected, `--model`/`--claude-bin` reaching the backend) without ever opening a real external
browser. Run the suite yourself for the exact current test count.

**Manual, with the fake runner** (no real Claude usage): the complete browser flow — new project →
choose Deep → approve → Start research → live Researching status with an activity feed → Completed
with a rendered report, clickable citations, and a passing citation-check badge → refresh → reopen,
still Completed. Also checked: keyboard focus on Start research; no horizontal overflow at 375px.

**Manual, with the real Claude Code CLI** (`claude auth status` / `claude --version` only — no
research job run, so no meaningful allowance spent): the real launcher starts, binds
127.0.0.1-only, correctly reports `claudeFound`/`authenticated` from the real installation, serves
the UI, and the full wizard through to a real **Ready to start** screen (title, approach, exact
prompt, allowance disclosure) renders correctly with a genuinely real, not-yet-clicked Start
button. Actually starting a real research run was intentionally **not** tested automatically — that
spends real Claude allowance and needs your explicit go-ahead first.

**Not yet verified:** behavior on Windows or on a Claude Code CLI version other than 2.1.278;
cross-browser rendering of the connected-mode screens beyond the Chromium-based pane used above
(the code uses only widely-supported web APIs, same as the rest of the UI); an actual end-to-end
real research run (by design — see above).

## Known limitations

- Only one research run can be active at a time, across the whole app (a deliberate v1 choice,
  stated in the interface).
- Document selection still records names only in both modes — no file content is ever uploaded,
  opened, or read; the field says so before you select anything, and a secure file-import design is
  a future step, not something this pass implements.
- The activity feed shows generic tool-use labels, not full tool arguments or model reasoning, by
  design (see Security above) — read the rendered report or `run.md` for the substantive content.
- The Markdown renderer covers what these reports use (headings, ordered/unordered lists with one
  level of nesting, tables, blockquotes, bold, italic, links, citations, and same-page `#anchor`
  links for in-app Help cross-references); it's intentionally minimal, not a full Markdown engine.
- The backend is a small stdlib-only HTTP server (no framework), sized for one local user — it is
  not meant to serve multiple simultaneous users or survive adversarial network conditions beyond
  the loopback/Host/Origin protections described above.
- Stop/shutdown process cleanup is verified for **graceful** termination (Stop button, `Ctrl+C`,
  `SIGTERM`) on POSIX; the Windows code path (`CTRL_BREAK_EVENT`/`taskkill`) is implemented but not
  yet run and observed on real Windows. A hard kill of the backend process itself (`kill -9`, a
  crashed terminal, an OS crash) bypasses this cleanup entirely — whatever the OS does with orphaned
  children in that case applies, not this app's graceful-shutdown guarantee.
- `start.py` is verified on Linux; macOS and Windows are expected to work (same stdlib-only code
  path) but have not actually been run and observed — see the root README and USER_GUIDE for the
  same caveat on `ui/launch.sh`.
