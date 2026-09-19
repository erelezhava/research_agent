# Adaptive deep research for Claude Code

One coordinator, two retrieval worker roles and a verifier. Markdown instructions plus a
stdlib-only Python structural checker. No autonomous scheduler or paid API fallback.

## Two ways to use this

**In a terminal**, open this project in Claude Code and run `/research <question>` directly (see
below). **In a browser**, run `bash ui/launch.sh` for a friendlier interface that guides you
through the question, an approach choice (Quick or Deep), and an editable brief, then launches the
same `/research` workflow for you — see [ui/README.md](ui/README.md) for what that adds, exactly
how it invokes Claude Code, and its security boundaries. Both paths write to the same kind of
files and use the same evidence rules below; the browser one just adds a guided front end and,
for projects it starts, its own `projects/<id>/` folder (see [Files](#files)).

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
rather than silently exceeding its own ceiling. Workers use Sonnet; the coordinator uses your
session model. Changing coordinator model does not automatically change worker configuration.

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
- projects/<project_id>/: self-contained folder for each browser-started project (its own
  `runs/`, `findings/`, `reports/`, `sources/`, plus `project.json`, `state/` and `logs/`) — see
  [ui/README.md](ui/README.md). Not committed to this repo (see .gitignore); created on your
  machine as you use the browser interface.
- ui/: the browser interface and its local backend (server/) — optional, terminal use needs
  neither.
- scripts/check_citations.py: structural citation checker; takes an optional `--root` so it can
  validate either the top-level layout above or a `projects/<id>/` folder.

State uses ordinary files so another research system can read the handoff. This is not a complete
ChatGPT/Codex integration. A receiving agent must reassess evidence rather than trust a predecessor.
