# Deep Research — browser interface prototype

A clickable, self-contained prototype of a friendly front end for this research agent.
It is meant to explore the experience, not to run research.

**Important:** this is a design preview. It does **not** connect to Claude, call any paid
service, start any real research, or read any documents you select. How a finished app would
run research — including any Claude integration, installation, or billing — is not decided and
is out of scope here. Everything shown is **fictional, made-up sample content**: the example
projects, their progress, and the sample report (whose "sources" are placeholder `example.com`
links) exist only to demonstrate how the interface works.

## How to launch

No installation, accounts, or browser extensions are needed.

### Option A — just open the file
Double-click `ui/research.html`, or open it from your browser's File → Open menu.
This works because the app has no build step and loads its example data from a local script.
(In this mode, projects you create are still saved in the browser between visits.)

### Option B — run the local launcher (recommended)
From a terminal:

```bash
bash ui/launch.sh
```

It serves the folder on **loopback only** at `http://127.0.0.1:8765/research.html`, waits until the
server is actually accepting connections, and *then* opens your browser. Press `Ctrl+C` to stop.

Pass a different port as the first argument: `bash ui/launch.sh 9000`.

The launcher handles common problems with clear messages:
- **No Python 3** → it tells you and points you to Option A (open `research.html` directly).
- **Invalid port** (not 1–65535) → it explains and shows the correct form.
- **Port already in use** → it says so and suggests the next port number.
- **Server fails to start** → it prints the server's own error output instead of opening a blank tab.

It requires **Python 3** and binds its `http.server` explicitly to `127.0.0.1`, so the server is
only ever reachable from this machine. There is no all-interfaces fallback; if Python 3 is missing,
open `research.html` in your browser directly instead (Option A).

## What you can do

1. **Welcome** — what the app does and a short first-time guide.
2. **My research** — your saved prototype projects plus example projects, each with clear status
   and a *Start research* button.
3. **New research** — a four-step wizard:
   1. *Your question* — type a plain-language question, optionally attach document names, and set
      how current / how deep (optional).
   2. *Follow-ups* — answer a few optional questions that sharpen the request.
   3. *Research approach* — pick between **Quick research** and **Deep research** (see below).
   4. *Review brief* — review and **edit** a research brief; your answers, depth/timeframe, document
      names, the chosen approach, and the selected prompt are all carried in.
4. **Research workspace** — example progress, questions needing attention, and a readable report
   with a table of contents, headings, tables, and clickable citations with a *Back to reading*
   button (open the sample report to see it).

## The "Research approach" step

After the follow-ups, the app shows two side-by-side cards — **Quick research** and **Deep
research** — each with a plain-language explanation, an **editable research prompt**, and a summary
of the expected depth and report style. You compare them, edit either prompt, and choose one
(Quick is selected by default). The choice is stored as a stable machine value (`quick` or `deep`)
together with the full selected prompt, so it could later drive the real research workflow — though
**no research is executed in this prototype**.

- *Quick* is aimed at everyday comparisons: a narrow scope, a few strong recent sources, the
  decision-relevant differences, and a concise report with a summary table and recommendation.
- *Deep* is aimed at technical decisions, expensive purchases, or professional work: broader scope,
  primary sources plus independent evidence, alternatives and contradictions, and a detailed report
  with limitations and uncertainties.

The step deliberately does **not** promise any duration, cost, or number of searches, because those
cannot be guaranteed.

**Local generation vs. future Claude improvement.** In this prototype the two prompts are written
entirely **on your device** from a simple built-in template that fills in your question, follow-up
answers, document names, and timeframe — there is no Claude call and no internet request. A finished
app could instead use Claude to *improve* these prompts (sharper wording, better-tailored scope),
but that is not implemented here. If you edit a prompt, your edit is preserved: going back to change
an earlier answer only regenerates the prompt(s) you did **not** touch.

## Saving (local to this browser)

Projects you approve and in-progress drafts are saved in this browser's **local storage** so they
survive a refresh. They are **not** written to disk as research project folders, and they do not
sync between browsers or machines. If the browser blocks local storage (e.g. strict private mode),
the app still works for the visit but shows a notice that nothing can be saved.

## What is real vs. simulated

| Part | Status |
|------|--------|
| Main navigation (Welcome / My research / New research / workspace) | Functional |
| New-research wizard and **brief editing** (edit text, add/remove steps, approve) | Functional |
| **Research approach** step: compare/edit two prompts, choose Quick or Deep | Functional |
| Carrying answers, depth/timeframe, documents, approach, and prompt into the brief | Functional |
| Local (on-device) prompt generation from a template | Functional |
| Claude-powered prompt *improvement* | Not implemented (future) |
| Creating a project, reopening it, and surviving refresh (local storage) | Functional |
| Table of contents, citation navigation, *Back to reading*, focus-reading toggle | Functional |
| Sample report content (commuter bike) | **Fictional**, placeholder sources, read-only |
| Progress bars, task status, "needs attention" items | Simulated / illustrative |
| Example projects | Fictional, made-up placeholders |
| Selecting documents | Names recorded only — **not uploaded, opened, or read** |

## Files

- `research.html` — page shell and navigation (the page you open).
- `styles.css` — all styling (light + dark, responsive, accessible focus states).
- `app.js` — navigation, storage, the Markdown renderer, and the brief editor.
- `data.js` — fictional example data (sample projects and the sample report).
- `launch.sh` — optional local-server launcher (loopback only).

## Known limitations

- Prototype only: it does not perform research, connect to Claude, or process documents.
- Saved projects live in one browser's local storage, not on disk; clearing site data removes them.
- "Needs attention" questions in the example workspace are display-only.
- The Markdown renderer covers what the example report uses (headings, ordered/unordered lists
  with one level of nesting, tables, blockquotes, bold, italic, links, citations); it is
  intentionally minimal, not a full Markdown engine.
