# Deep Research — browser interface

A friendly front end for the research agent in this repository. It has two modes, chosen
automatically by whether a local backend is running:

- **Connected** (via `bash ui/launch.sh`): approved briefs create real projects on disk and
  **Start research** launches the actual `/research` workflow through your own local Claude Code
  CLI. This is real research, not a simulation — it reads/writes files and can search the web,
  using your own Claude Code sign-in and allowance.
- **Standalone** (opening `ui/research.html` directly, no backend running): a design preview with
  fictional example content and browser-local drafts — nothing is sent anywhere. Every feature this
  mode had before still works exactly the same; connecting a backend only adds capability on top.

The app always tells you which mode you're in (the top banner and footer say so), and the
example/sample content stays clearly labeled as fictional in both modes.

## How to launch

### Connected (recommended): `bash ui/launch.sh`

```bash
bash ui/launch.sh
```

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
  --tools Read,Write,Edit,Bash,Grep,Glob,WebSearch,WebFetch,Task \
  --disallowedTools "Bash(rm *)" "Bash(sudo *)" "Bash(chmod *)" "Bash(chown *)" \
                     "Bash(dd *)" "Bash(mkfs*)" "Bash(shutdown*)" "Bash(reboot*)" "Bash(git push*)" \
  --permission-mode acceptEdits \
  --permission-prompts none \
  --strict-mcp-config \
  --setting-sources project \
  --session-id <generated-uuid>          # or --resume <uuid> for Resume
```

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

- `--allowedTools` does **not** restrict tool availability in `-p` mode on this version — it only
  affects what would be auto-approved if something prompted. The real hard boundary is `--tools`,
  confirmed by asking the model to enumerate its own granted tools with each flag combination.
- Without `--strict-mcp-config`, unrelated account-level MCP connectors (Gmail, Drive, Spotify,
  Docs, in this Anthropic environment) leaked into the toolset even under a tight `--tools`
  allowlist. `--strict-mcp-config` with no `--mcp-config` removed all of them.
- A brand-new, never-interactively-trusted working directory (any fresh `projects/<id>/`) denies
  Write by default. `--permission-mode acceptEdits` is required for unattended file writes to work
  at all; `--permission-mode bypassPermissions` (equivalent to `--dangerously-skip-permissions`)
  is never used.
- `--disallowedTools "Bash(rm *)"`-style patterns reliably deny specific subcommands even while
  Bash itself stays available for the citation checker — verified: `rm` denied and logged,
  `echo`/`Write` succeeded, in the same session.
- `--session-id <uuid>` is honored verbatim, and `--resume <uuid>` reliably reconnects with full
  memory — verified with a round-trip secret-word test across two separate invocations.

### Authentication and permissions

Claude Code uses **your own existing sign-in** (`claude auth login`, the same one your terminal
uses) — this app never asks for or stores an API key, and it never sets `ANTHROPIC_API_KEY`. The
backend checks `claude auth status` before allowing Start; if you're not signed in, it says so
plainly instead of trying anyway.

The tool set above (Read/Write/Edit/Bash/Grep/Glob/WebSearch/WebFetch/Task) is the smallest set
that still lets the actual workflow read/write its own project files, run
`scripts/check_citations.py`, and delegate to `.claude/agents/`'s subagents — verified to be
necessary and sufficient, not a guess. If a future CLI version can't reproduce this safely, the
right response is the Needs attention state described below, not a weaker permission mode.

### What happens on…

- **A clarifying question the model would normally ask you**: with nobody able to answer a
  permission or input prompt, the run either proceeds (for things this configuration already
  allows) or is cleanly denied (for anything it doesn't, e.g. `rm`) — nothing hangs waiting for a
  human. If the coordinator genuinely needs your input before it can produce a report, it stops and
  saves that in `run.md`; the project shows as **Needs attention**, and the workspace shows the
  run's own saved notes so you can see what it's asking.
- **A permission denial** (a disallowed pattern, or something outside the granted tools): recorded
  and the run continues past it rather than crashing; if that denial prevents a report from being
  written at all, the project ends up **Needs attention** or **Failed** depending on how the run
  concluded.
- **A usage-limit interruption**: detected from the CLI's own result text (patterns like "usage
  limit", "rate limit", "quota", "try again later") and shown as **Interrupted**, with a **Resume**
  button that reconnects the same session via `--resume` — explicitly restating the project's path
  rooting rather than relying only on conversation memory, since CLAUDE.md itself warns that
  context compaction can lose the transcript.
- **A crash** (of the `claude` process, or of the backend process itself): state lives on disk in
  `projects/<id>/state/run.json`, written atomically, so a server restart re-reads it rather than
  losing it. If the recorded process is confirmed dead and the run never reached a terminal state,
  it's treated honestly as no longer running rather than claimed as still in progress.
- **Malformed or unexpected CLI output**: unparseable lines are skipped for the activity feed
  (never shown raw) but always kept in the local log file; if no valid completion result was ever
  seen, the run ends in **Failed** with a generic, honest message rather than a guess.

### Browser workspace states

**Ready to start · Starting… · Researching · Needs attention · Completed · Failed · Interrupted —
resumable.** These come from the run's actual saved status (`projects/<id>/state/run.json`) and
current files on disk — never a simulated countdown. While researching, the page polls the backend
every ~2 seconds and shows the run's own saved notes (`run.md`, rendered) plus a short activity
feed of generic tool-use labels ("Reading a project file", "Searching the web", …) — never the
model's raw reasoning or full tool output. Only one research run can be active at a time in this
prototype; starting a second project while one is running is refused with a clear message.

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
- `../server/app.py`, `store.py`, `runner.py` — the local backend: HTTP app, project storage, and
  the verified Claude Code invocation (see Connected mode above).
- `../tests/test_server.py`, `../tests/fixtures/fake_claude.py` — automated tests using a fake
  `claude` executable; no real CLI or Claude allowance is used by the test suite.

## Verification

**Automated** (`python3 -B -m unittest discover -s tests -v`, 36 tests, all against a fake `claude`
— zero real Claude allowance consumed): mode (`quick`/`deep`) passed correctly; the approved prompt
preserved exactly, including special characters; shell metacharacters in a prompt proven inert (a
marker file is asserted never created); unsafe project ids and path-traversal attempts rejected;
only one run active at a time; successful completion exposes the report; a CLI failure produces a
clear Failed state; a usage-limit-shaped interruption produces Interrupted, and Resume then
completes it; state survives a full server restart; the server binds loopback-only; cross-origin
POSTs are rejected; oversized request bodies are rejected; the legacy citation-checker tests still
pass unchanged.

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
  opened, or read; a secure file-import design is a future step.
- The activity feed shows generic tool-use labels, not full tool arguments or model reasoning, by
  design (see Security above) — read the rendered report or `run.md` for the substantive content.
- The Markdown renderer covers what these reports use (headings, ordered/unordered lists with one
  level of nesting, tables, blockquotes, bold, italic, links, citations); it's intentionally
  minimal, not a full Markdown engine.
- The backend is a small stdlib-only HTTP server (no framework), sized for one local user — it is
  not meant to serve multiple simultaneous users or survive adversarial network conditions beyond
  the loopback/Host/Origin protections described above.
