# Adaptive deep research for Claude Code

One coordinator, two retrieval worker roles and a verifier. Markdown instructions plus a
stdlib-only Python structural checker. No autonomous scheduler or paid API fallback.

## Two ways to use this

**In a terminal**, open this project in Claude Code and run `/research <question>` directly (see
below). **In a browser**, run `python3 start.py` (or `bash ui/launch.sh` on Linux/macOS) for a
friendlier interface that guides you through the question, an approach
choice (Quick or Deep), and an editable brief, then launches the same research workflow for you —
see [ui/README.md](ui/README.md) for what that adds, exactly how it invokes Claude Code, and its
security boundaries. Both paths write to the same kind of files and use the same evidence rules
below; the browser one just adds a guided front end and, for projects it starts, its own
`projects/<id>/` folder (see [Files](#files)). The browser path also has no Bash tool available to
the Claude session it launches (unlike a terminal `/research` session, which does) — see
[ui/README.md](ui/README.md) for what that means for the citation checker. Project folder names are
derived from the research title, followed by a timestamp and short unique suffix, so they remain
recognizable outside the browser.

The browser and its backend stay on your computer, but a real research run sends your question and
working context to Claude through your signed-in Claude Code CLI and fetches relevant web sources.
The browser-started Claude process has no Bash tool or unrelated account connectors. It exposes and
pre-approves the same narrow tool list, including WebSearch and WebFetch, because an unattended
browser run has no interactive permission window. Its file tools are still granted at the
repository level by Claude Code, however: keeping writes inside the chosen `projects/<id>/` folder
is enforced by the workflow instructions, not by an operating-system per-project sandbox. Treat
this repository copy as the research app's trusted workspace. See the full
[security explanation](ui/README.md#security-boundaries-this-backend-enforces).

## Start (terminal)
Open this project in Claude Code and run:

    /research <your question>

Supply scope, timeframe and desired depth when useful. The coordinator saves the run ID early.
Add `mode: quick |` or `mode: deep |` before the question to pick a ceiling explicitly (e.g.
`/research mode: quick | <question>`); with no prefix, the default is deep — the original,
unprefixed behavior, unchanged. Quick mode is deliberately lighter (see Method and budget below)
and will say so plainly and suggest deep mode rather than silently exceeding its own ceilings.
Sources may be plain text, CSV, JSON or PDF. This worker configuration has no Office conversion
capability; convert DOCX/XLSX/PPTX into an appropriate readable format while preserving locators.
Do not interpret unsupported or partial extraction as absence of evidence.

## Resume after usage limits, a crash, or a model change
After allowance resets, open the project and enter:

    /research resume: <run_id>

Find IDs under runs/. Use the same ID, not a newly phrased question. Only one coordinator should
operate the run at a time. You may use a new session: run.md, task memos and JSON evidence retain
portable state. The coordinator reconciles files, freshness, inputs and unfinished work before
resuming. Resumption costs tokens and can require rechecking sources; it is not free.
A changed report invalidates affected verification. Partial records are leads, not completed work.

The instructions require checkpoints during research, not only after a usage error. This reduces
loss, but prompt compliance and filesystem writes are not a crash-recovery guarantee. Context
compaction and account allowance are different: reload saved state after compaction; wait for an
account reset when blocked. This project does not itself wait and restart automatically.

For browser-started projects, reopen **My research** after an allowance reset or after restoring a
temporary internet/DNS/API connection and click **Resume research**. These interruptions preserve
the same Claude session and completed work. If the run stopped because it could not access any evidence, it appears as **Needs
attention** with its saved failure notes and a **Resume research** button. The app resumes the same
Claude session and preserves the existing plan; it does not label the failure notes as a completed
answer.

If a report stops because its planned research budget was exhausted, the browser shows **Continue
research**. That resumes the same session and adds one bounded pass focused on unfinished checks;
it preserves the report and gathered evidence, but uses additional Claude allowance. The **My
research** list keeps long questions to a short preview so project cards remain easy to scan.

Official Claude Code documentation exposes usage percentages and reset timestamps to a custom
status-line script when available for the account/session:
https://code.claude.com/docs/en/statusline
Such a script could save a small usage snapshot for an agent or supervisor to read. Missing data
must remain unknown; percentages do not guarantee another request can finish. No status-line
settings, quota monitoring, automatic launcher or billing settings are installed by this project.
Manual resume is the supported workflow here; live rate-limit recovery has not been tested.

## Method and budget
The coordinator chooses evidence standards for the question, allows dependencies and investigates
material gaps. **Deep mode** defaults are 20 collection calls, 12 verification source checks, at
most two workers at once and two follow-up rounds — the original, unchanged rigorous workflow.
**Quick mode** is deliberately lighter: 6 collection calls, 3 verification checks, one worker at a
time, one follow-up round, and a proportionately concise report (no exhaustive background, no
comparing every individual product variant). These are prompt-level ceilings, not target spending
or account quota guarantees. Exhausted budgets produce a checkpoint or qualified result, not an
assertion of completeness; quick mode that turns out to need more says so and suggests deep mode
rather than silently exceeding its own ceiling. Workers use Sonnet. In a terminal `/research`
session the coordinator uses whatever model your interactive session is running; in a
browser-started project the coordinator model is a fixed, explicitly-configured value (Sonnet by
default; see `ui/README.md` for how to change it) — it does **not** inherit "your session model",
since there is no interactive session to inherit from. Changing coordinator model does not
automatically change worker configuration.

The browser's explicit **Continue research** action is a new budget decision: it permits one extra
bounded pass (Quick: up to 3 collection calls and 2 verification checks; Deep: up to 8 and 5),
records the extension in `run.md`, and stops with the warning again if important work still remains.

## Evidence and validation
CLAUDE.md defines schema version 2. Each task has a readable memo plus structured JSON with
actual excerpts, qualifications, provenance and retrieval coverage. Reasoning tasks retain their
premises and argument; a citation checker cannot prove an argument valid.

From the project directory:

    python3 scripts/check_citations.py runs/<run_id>
    python3 -B -m unittest discover -s tests -v

The checker requires a final Sources section with exact source/access-date links to complete
structured records. It rejects missing records, malformed citations, duplicate IDs/numbers and
inconsistent completion markers. Unused sources are warnings. It does not detect every uncited
claim or verify source truth, quotation accuracy, freshness, cache compatibility or sufficiency.
Those remain coordinator/verifier responsibilities. Tests are synthetic and use no live models.
In the browser, plain **Completed** means this checker ran and passed. A failed, missing, timed-out,
or otherwise unavailable check produces **Completed with warnings**; a repair button is offered
only when the checker actually found a structural citation problem. A run that records
`inaccessible_evidence` or `needs_clarification` is **Needs attention**, even if it wrote a Markdown
file. `important_uncertainty` and `budget_exhausted` produce **Completed with warnings**. Older
projects with a falsely clean status are reconciled from their saved stop reason when reopened.
`budget_exhausted` projects with a saved session offer **Continue research**; this is separate from
repairing a structural citation problem.

## Existing records
This repository ships with **no bundled research runs** — the `findings/`, `reports/`, `runs/`
and `sources/` directories start empty (each keeps a `.gitkeep` placeholder). Runs you create
locally stay on your machine; add your own if you want to keep worked examples. When resuming or
reviewing any run, recheck material claims against the original evidence rather than trusting a
predecessor, and never manufacture excerpts or missing metadata.

## Files
- .claude/commands/research.md: coordinator workflow, mode selection, checkpoints and resume.
- .claude/agents/: retrieval and verification instructions.
- CLAUDE.md: shared rules, paths, memo and JSON contract.
- runs/<run_id>/run.md: scope, methods, task status, inputs, gaps and next actions.
- runs/<run_id>/verification.md: versioned audit coverage and issue dispositions.
- findings/<run_id>/<task_id>.md and .json: task findings and evidence.
- reports/<run_id>.md: report; sources/: user inputs.
- projects/<descriptive-title>-<timestamp>-<suffix>/: self-contained folder for each
  browser-started project (its own
  `runs/`, `findings/`, `reports/`, `sources/`, plus `project.json`, `state/` and `logs/`) — see
  [ui/README.md](ui/README.md). Not committed to this repo (see .gitignore); created on your
  machine as you use the browser interface. Removed projects move to `projects/.trash/` rather
  than being deleted (see [ui/README.md](ui/README.md)).
- ui/: the browser interface and its local backend (server/) — optional, terminal use needs
  neither.
- start.py: a stdlib-only, cross-platform launcher for the browser interface (alternative to
  `ui/launch.sh`) — see [ui/README.md](ui/README.md).
- scripts/check_citations.py: structural citation checker; takes an optional `--root` so it can
  validate either the top-level layout above or a `projects/<id>/` folder.

State uses ordinary files so another research system can read the handoff. This is not a complete
ChatGPT/Codex integration. A receiving agent must reassess evidence rather than trust a predecessor.
