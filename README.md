# Adaptive deep research for Claude Code

One coordinator, two retrieval worker roles and a verifier. Markdown instructions plus a
stdlib-only Python structural checker. No autonomous scheduler or paid API fallback.

## Start
Open this project in Claude Code and run:

    /research <your question>

Supply scope, timeframe and desired depth when useful. The coordinator saves the run ID early.
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
material gaps. Defaults are 20 collection calls, 12 verification source checks, at most two workers
at once and two follow-up rounds. These are prompt-level ceilings, not target spending or account
quota guarantees. Simple work should use fewer calls. Exhausted budgets produce a checkpoint or
qualified result, not an assertion of completeness. Workers use Sonnet; the coordinator uses your
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
- .claude/commands/research.md: coordinator workflow, checkpoints and resume.
- .claude/agents/: retrieval and verification instructions.
- CLAUDE.md: shared rules, paths, memo and JSON contract.
- runs/<run_id>/run.md: scope, methods, task status, inputs, gaps and next actions.
- runs/<run_id>/verification.md: versioned audit coverage and issue dispositions.
- findings/<run_id>/<task_id>.md and .json: task findings and evidence.
- reports/<run_id>.md: report; sources/: user inputs.

State uses ordinary files so another research system can read the handoff. This is not a complete
ChatGPT/Codex integration. A receiving agent must reassess evidence rather than trust a predecessor.
