# User Guide — Deep Research

A friendly guide to installing, launching, and using this research app — written for people who
have never used Claude Code, "agents," a terminal, or written a research prompt before. If a word
might be unfamiliar, this guide explains it the first time it's used.

This same guide is also built into the app itself: once it's running, click **How to use** in the
top navigation for a searchable, on-page version with the same sections, plus quick "Help" links
placed right next to the buttons and states they explain.

---

## Contents

1. [What this application does](#1-what-this-application-does)
2. [What you need](#2-what-you-need)
3. [Download and installation](#3-download-and-installation)
4. [Launching the application](#4-launching-the-application)
5. [Starting research](#5-starting-research)
6. [Quick versus Deep research](#6-quick-versus-deep-research)
7. [Following progress](#7-following-progress)
8. [Answering questions from the agent](#8-answering-questions-from-the-agent)
9. [Reading the report](#9-reading-the-report)
10. [Project files and privacy](#10-project-files-and-privacy)
11. [Pausing, resuming, and failures](#11-pausing-resuming-and-failures)
12. [Sharing and updating](#12-sharing-and-updating)
13. [Troubleshooting](#13-troubleshooting)
14. [Advanced section](#14-advanced-section)

---

## 1. What this application does

This app helps you turn a rough question — "which laptop CPU should I get," "is this PCB design
change safe" — into a properly researched, written-up answer. In plain terms, it:

- Takes your question, written in ordinary language, and turns it into a clear **research brief**
  (a short plan of what will be investigated and how).
- Lets you choose between two speeds: **Quick research** for everyday questions, or **Deep
  research** for decisions where getting it wrong would be costly (see [section 6](#6-quick-versus-deep-research)).
- Runs the actual research **using your own local Claude Code installation** — the same one you
  might use in a terminal — reading sources and writing up findings.
- Shows you real progress as it works, and pauses to ask you for missing information when it
  genuinely needs it.
- Gives you back a structured report: an answer, a comparison, and — importantly — **numbered
  citations** you can click to jump straight to the evidence behind each claim.
- Lets you **resume** research that got interrupted (for example, by a usage limit) instead of
  starting over.

**What it cannot guarantee.** This app cannot promise an exact finish time, that it accessed every
possible source on a topic, or that its conclusions are certain. Research takes however long the
underlying model and web access take on the day — sometimes fast, sometimes slow — and the app
never shows a fake countdown or progress percentage to disguise that. It labels what it found
versus what it couldn't confirm, and you should read a report critically, the way you'd read any
piece of research someone handed you.

## 2. What you need

These are the requirements actually verified while building this app — not assumptions:

| Requirement | Status |
|---|---|
| **Operating system** | Built and tested on **Linux**. The launcher is a standard shell script that should also work on **macOS** (which includes the same kind of shell) — this has **not** been tested. **Windows** needs a Linux-style environment such as WSL or Git Bash to run it; this has **not** been tested either. |
| **Python** | **Python 3** — no separate installation of packages needed, only the standard Python that ships with most systems. Tested with a recent Python 3; no specific minimum version was verified. |
| **Claude Code** | Must be installed separately (it is **not** bundled with this app) — see [claude.com/code](https://claude.com/code) or your organization's install instructions. |
| **Signing in** | You must sign in once with `claude auth login` (covered in [section 4](#4-launching-the-application)). This app uses that existing sign-in — it never asks you for a password or API key itself. |
| **A Claude subscription/allowance** | Yes — starting research uses your own Claude Code account's usage allowance, the same one your terminal sessions use. This app does not include or purchase any allowance of its own. |
| **An API key** | **Not required, and not used.** This app never asks for or stores an API key. |
| **Browser** | Verified in a Chromium-based browser during development. The app uses only standard, widely supported web features and is expected to work in current Firefox, Safari, and Edge, but those have **not** been individually tested. No browser extensions are needed or used. |

If you only want to look around the interface without installing Claude Code, you can still open
the app's preview by double-clicking `ui/research.html` — see [section 4](#4-launching-the-application).
That mode shows example content and does not run real research.

## 3. Download and installation

You don't need to know what a "repository" or "terminal" is to get the files onto your computer.

### Option A: Download as a ZIP (recommended for most people)

1. On the project's GitHub page, click the green **Code** button, then **Download ZIP**.
2. Find the downloaded file (usually in your **Downloads** folder) and **extract** it: on Windows,
   right-click it and choose **Extract All**; on macOS, double-click it and it unzips itself; on
   Linux, right-click and choose **Extract Here** (or similar).
3. **Move the extracted folder** somewhere normal and writable — your Documents folder, Desktop,
   or home folder are all fine. Avoid folders that need special permission to write to.
4. **Do not run anything from inside the ZIP file itself.** Some systems let you browse a ZIP's
   contents without fully extracting it first — the app needs to create and edit files as it runs,
   which doesn't work from inside an archive. Extract it fully first (step 2).

### Option B: Clone with Git (optional, for people already comfortable with Git)

```bash
git clone <this repository's URL>
```

This does the same thing as Option A but keeps the folder connected to GitHub, making later
updates a single `git pull` (see [section 12](#12-sharing-and-updating)). If that sentence didn't
mean anything to you, use Option A instead — there's no downside.

### Checking prerequisites

- **Python 3**: most Macs and Linux systems already have it. To check, see
  [section 4](#4-launching-the-application) below — the launcher checks for you and tells you
  plainly if it's missing.
- **Claude Code**: install it from [claude.com/code](https://claude.com/code) if you haven't
  already, then run `claude auth login` once to sign in. You only need to do this once, ever, on
  this computer.

## 4. Launching the application

The one and only launch method that has been built and verified for this app is a single command
run from a terminal — there is currently no double-click launcher. If you've never opened a
terminal, that's completely fine; here's exactly how.

### Step 1: Open a terminal in the project folder

- **Windows**: open the extracted folder in File Explorer, then type `cmd` into the address bar at
  the top and press Enter — this opens a command prompt already in the right folder. (This app's
  launcher needs a Linux-style shell such as WSL or Git Bash to actually run — plain Windows
  Command Prompt cannot run it. If you have WSL or Git Bash installed, open that instead, `cd` into
  the folder, and continue below.)
- **macOS**: open **Terminal** (search for it with Spotlight, the magnifying glass in the top
  right), then type `cd ` (with a trailing space), drag the extracted project folder from Finder
  into the Terminal window, and press Enter.
- **Linux**: most file managers let you right-click inside the folder and choose **Open Terminal
  Here**. Otherwise, open your terminal app and `cd` to wherever you extracted the folder.

### Step 2: Run the launcher

Type this and press Enter:

```bash
bash ui/launch.sh
```

### What a successful start looks like

You'll see a few lines print, ending with something like:

```
Deep Research
Backend: /path/to/deep-research/server/app.py
Address: http://127.0.0.1:8765/  (loopback only)

Backend is up. Opening your browser…
Press Ctrl+C to stop.
```

Your default web browser should open automatically to that address. **"Loopback only" means the
app is reachable only from this computer** — nothing about it is exposed to your network or the
internet; no one else can connect to it, even on the same Wi-Fi.

### If the browser doesn't open automatically

Copy the address shown (`http://127.0.0.1:8765/`) and paste it into your browser's address bar
yourself.

### Stopping the app

Go back to the terminal window and press **Ctrl+C**. The app stops immediately; nothing keeps
running in the background afterward.

### Handling common startup problems

- **Port already in use**: run `bash ui/launch.sh 9000` instead (or any other number) to use a
  different port. The message will tell you this is the problem.
- **Claude Code not found / not signed in**: the launcher still starts (so you can look around),
  but prints a note, and the app itself will show a clear message on the *Start research* screen
  rather than pretending research can begin. Install Claude Code and run `claude auth login`, then
  try again.
- **Python 3 not found**: the launcher explains this and points you to opening
  `ui/research.html` directly instead, which shows the interface with example content (no real
  research) and needs no installation at all.

See [section 13](#13-troubleshooting) for more, and [section 14](#14-advanced-section) for manual
commands and log locations.

## 5. Starting research

Once the app is open in your browser:

1. Click **New research**.
2. **Describe your question** in ordinary language, the way you'd ask a knowledgeable friend — a
   sentence or two is enough.
3. Optionally **add documents** — you can attach files here, but see the important note in
   [section 10](#10-project-files-and-privacy): only their *names* are recorded right now, not
   their content.
4. Open **Advanced options** if you want to set a **timeframe** ("Latest available," "Within the
   last year," or "Any time — background is fine") or a rough depth hint. This step is optional.
5. Click **Continue**, and answer any of the **follow-up questions** that are useful — every one of
   these is optional; skip anything that doesn't apply and click through.
6. On the **Research approach** step, **compare the Quick and Deep prompts** side by side (see
   [section 6](#6-quick-versus-deep-research)) and pick one.
7. **Edit the chosen prompt** if you want to sharpen the focus — this is a real text box, not just
   a preview.
8. Click through to **review the final brief** — the title, scope, and planned steps — and edit
   anything that isn't quite right.
9. Click **Approve brief & save project**, then on the next screen click **Start research**.
10. **Leave the app open, or close the browser tab and come back later** — research keeps running
    in the background as long as the terminal window from step 4 above is still open. Reopen
    **My research** any time to check on it (see [section 7](#7-following-progress)).

## 6. Quick versus Deep research

| | Quick research | Deep research |
|---|---|---|
| Best for | Everyday comparisons, straightforward factual questions, early exploration, or when a concise answer is enough | Engineering/technical design decisions, expensive purchases, professional or business decisions, conflicting evidence, anything needing careful verification |
| Scope | Narrow — the main options, compared at a practical level | Broad — detailed comparisons, sub-categories, and credible alternatives |
| Sources | A small number of strong, recent sources | Primary sources plus independent supporting evidence |
| Checking | Still cites sources and checks the important claims | Full evidence records and a separate verification pass |
| Report | Concise — a summary table and a clear recommendation | Detailed — full comparison, limitations, and remaining uncertainty spelled out |

Both modes use citations and check the claims that matter — Quick is lighter and narrower, not
uncited or unchecked. Neither mode promises an exact finish time or a token/cost figure, because
those genuinely can't be guaranteed in advance.

**Examples:**
- *"Should I get an Intel Core i5 or i7 for a new laptop?"* — an ordinary purchasing question.
  **Quick research** is the right fit.
- *"Evaluate PCB insertion-loss simulation versus measurement methods for this hardware design
  I'm actually building."* — a technical decision with real engineering consequences. **Deep
  research** is the right fit.

If Quick research turns out to be too limited for what you asked, the report will say so plainly
and suggest re-running the same question in Deep mode — it will not silently stretch past its own
limits and pretend to be a full deep report.

## 7. Following progress

Open **My research** to see every project's current state. Each one is always in exactly one of
these:

| State | What it means | What to do |
|---|---|---|
| **Ready to start** | The brief is approved but research hasn't begun | Review the prompt, then click **Start research** when ready |
| **Starting…** | The research process is being launched | Just wait a moment — this is brief |
| **Researching** | Real research is actively running | Watch the activity list if you like, or leave and come back later |
| **Needs attention** | It stopped before writing a report, usually because it needs something from you | Read its saved notes (see [section 8](#8-answering-questions-from-the-agent)) |
| **Completed** | A report was written | Open the project to read it (see [section 9](#9-reading-the-report)) |
| **Failed** | It did not finish successfully | Read the error message; see [section 13](#13-troubleshooting) |
| **Interrupted — resumable** | It stopped partway (often a usage limit, or the app/computer closing) | Click **Resume** to continue the same work |

**What's real versus estimated:** the state shown always reflects what's actually saved on disk —
there is no simulated progress bar or fake percentage anywhere in this flow. While *Researching*,
the page shows a short activity list (like "Searching the web," "Writing a project file") built
from the run's own real events, refreshed automatically every couple of seconds. This is a
plain-language summary of activity, not a live transcript of everything the model is doing.

## 8. Answering questions from the agent

Sometimes the research can't responsibly continue without something only you know. When that
happens, the project shows **Needs attention**, and opening it shows the run's own saved notes
explaining what's missing. There's no separate chat box for this yet — you address it by starting
a **new research project** with that detail included, or by adding it directly into your prompt
before you first click Start research.

Practical examples of the kind of detail that helps:

- The **exact component model or revision** (e.g. "VSC7552-V/5CC" rather than just "a switch chip").
- Your **available budget**.
- Whether you already have an **existing stack-up or schematic** to work from.
- The **required frequency range** for an electrical design.
- Whether you **have the relevant datasheet** already, or need it found.

Giving this kind of specific detail up front — even just a sentence added to your original
question — can materially improve the answer, because the research can go straight to the exact
right documents instead of guessing at your context.

## 9. Reading the report

A finished report is a normal, readable document with:

- A **summary and recommendation** near the top.
- **Confirmed facts** written plainly, with **inference or interpretation** labeled as such rather
  than blended in as if equally certain.
- A **limitations** section describing what wasn't checked or couldn't be found.
- **Tables** comparing options side by side, where that's the clearest format.
- **Numbered citations** like `[3]` next to specific claims.

**Click any citation number** to jump straight to that source in the report's own Sources list. A
**"Back to reading"** button then appears so you can return to exactly where you were, rather than
having to scroll back and find your place. Longer reports also show a **table of contents** built
from the report's own headings, so you can jump between sections directly.

**Why "not found" doesn't mean "doesn't exist."** If a report says a detail was not found, that
means *this particular research pass* didn't turn it up — not that it's confirmed false or absent
everywhere. Treat a "not found" the same way you'd treat a colleague telling you "I looked and
couldn't find it" — worth following up on yourself if it matters a lot to your decision, not a
final verdict.

## 10. Project files and privacy

Every project you start creates its own folder on your computer at `projects/<project-id>/`.
In plain terms, it holds:

- **Your research request** — the question and the approach you chose.
- **Sources** — currently just the *names* of any documents you selected when starting (see
  the important note below).
- **Progress notes** — a checkpoint file the research updates as it works.
- **Evidence** — the individual pieces of research gathered along the way.
- **Verification** — a record of which claims were double-checked.
- **The final report**.
- **A local log** — a technical record of the run, kept only on your computer.

**What actually happens during research — please read this carefully:**

- The app itself runs **entirely on your computer** and its local service only ever listens on
  `127.0.0.1` (your own machine) — nothing about the app is exposed to your network.
- **However**, actually doing research means your question and its findings **are sent to Claude**
  (via your own signed-in Claude Code) and relevant **web pages are fetched from the open
  internet** while researching — that's simply what "doing research" requires. Don't put anything
  in a research question that you wouldn't want processed by Claude or potentially requested from
  a website.
- **Documents you select are not processed.** Only their file names are recorded right now — no
  file content is uploaded, opened, or read by this app. If a research question depends on the
  actual contents of a document, describe the relevant details in your question text instead for
  now.
- **Clearing your browser's storage** only removes drafts you were composing in **standalone**
  preview mode (see [section 14](#14-advanced-section)) — it has **no effect** on real projects,
  which live as files in `projects/` regardless of what your browser does. Conversely, **deleting
  a project's folder** removes that project for good — there is currently no in-app delete button
  for real projects, so this is a manual step (see [section 12](#12-sharing-and-updating)).

## 11. Pausing, resuming, and failures

| Situation | What happens | What to do |
|---|---|---|
| **Claude usage allowance runs out mid-run** | The project moves to **Interrupted — resumable** | Click **Resume** once you have allowance again — it continues the same conversation rather than starting over |
| **You close the app (Ctrl+C) or shut down your computer while research is running** | The project is corrected the next time you open it, from **Researching** to **Interrupted — resumable**, if a session was already recorded | Reopen the app later and click **Resume**; if no session was recorded yet, start a new project instead |
| **Your internet connection drops** | The research workflow will typically report this as a source it couldn't reach, not a hard crash, and continue with what it has | Read the report's limitations section for what wasn't checked |
| **Claude needs a permission it wasn't already granted** | That specific action is safely declined and logged; a narrow, fixed set of actions is pre-approved for unattended research (reading/writing project files, running the report's citation check, and web search/fetch) | If this repeatedly blocks a real need, it will show up in the run's saved notes or the Failed state's message |
| **A source can't be opened** | Recorded as a gap in that source's evidence, not treated as proof something is false | Read the limitations section; try providing the source directly in your question if you have it |
| **Research stops with real uncertainty remaining** | This is normal and expected — the report says so plainly rather than guessing | Read the "limitations" section; consider re-running in Deep mode for more thorough checking |
| **A report fails its automatic citation check** | The project still completes and the report is still shown, with a visible "Citation check found issues" note | Read the report a little more carefully around its citations; this flags a structural issue, not a guaranteed error |

## 12. Sharing and updating

### Sharing a report

The report itself (what you see when a project is Completed) is meant to be shareable. To share
**only** the report, copy its text out of the browser rather than sending the whole project
folder — the folder also contains your original question, intermediate notes, and a local log,
which weren't written with an outside audience in mind.

**Before sharing anything publicly, review it first.** Check that:
- It doesn't contain anything you consider private that you mentioned in your original question.
- You're not accidentally including the whole `projects/<id>/` folder (which has your local
  logs and file paths specific to your computer) when you only meant to share the report.

### Updating from GitHub without losing your research

Your real projects live under `projects/` in your copy of this app, and that folder is
**deliberately excluded** from what gets tracked/updated by Git (see `.gitignore`) — a normal
update to the app's own code does not touch it. To update safely:

- If you downloaded a ZIP (Option A in [section 3](#3-download-and-installation)): download the
  new ZIP, extract it to a **separate** new folder, and copy your `projects/` folder over into the
  new one before running it — do not just extract on top of your old folder blindly.
- If you used `git clone` (Option B): `git pull` in the project folder. Since `projects/` isn't
  tracked by Git, pulling updates leaves it untouched automatically.

### Backing up your projects

To back up your research, simply **copy the entire `projects/` folder** somewhere safe (an
external drive, a personal cloud folder, etc.) — it's ordinary files and folders, nothing special
is needed to read or restore them later.

## 13. Troubleshooting

| Problem | Likely cause | Try this |
|---|---|---|
| The launcher does nothing / no window opens | Your browser may not have opened automatically | Copy the address printed in the terminal (`http://127.0.0.1:8765/`) into your browser's address bar |
| Browser says it can't connect | The app isn't running, or you used the wrong address | Check the terminal window is still open and didn't print an error; re-check the exact address it printed |
| "Claude Code CLI is not available on this machine" | Claude Code isn't installed, or isn't findable on your system PATH | Install it from claude.com/code, then restart the app |
| "Claude Code is not signed in" | You haven't run `claude auth login` yet (or it expired) | Run `claude auth login` in a terminal, then try Start research again |
| Start research does nothing / shows an error immediately | Usually one of the two rows above | Check the exact message shown — it names the specific problem |
| "another research run is already active" | This app only allows **one** research run at a time, across all projects | Wait for the current one to finish, or open it and see its status |
| Project shows "Needs attention" | The research stopped before writing a report, often needing more detail from you | See [section 8](#8-answering-questions-from-the-agent) |
| "Your Claude usage limit was reached during this run" | Your Claude account's allowance ran out | Wait for it to reset, then click **Resume** on that project |
| No report appears on a Completed project | Rare — the run may not have written a report despite completing | Check the project's log file (see [section 14](#14-advanced-section)) for detail |
| Clicking a citation number does nothing | The report may not have a matching Sources entry for that number | This indicates a structural issue in that particular report; the citation-check badge on the report will usually also flag it |
| A document I selected doesn't seem to affect the research | This is expected right now — documents are not read, only their names are noted | Include the relevant details as text in your question instead, for now (see [section 10](#10-project-files-and-privacy)) |

## 14. Advanced section

This section is for people comfortable with a terminal; everything above works without it.

### Manual launch and port selection

```bash
bash ui/launch.sh          # default port 8765
bash ui/launch.sh 9000     # use a different port
```

You can also run the backend module directly for more control:

```bash
cd deep-research           # the project's root folder
python3 -m server.app --host 127.0.0.1 --port 8765
```

`--host` only accepts loopback addresses (`127.0.0.1`, `localhost`, `::1`) — it refuses to bind
anywhere else, by design.

### Log locations

Each project keeps its own log at:

```
projects/<project-id>/logs/session-<session-id>.log
```

This is the full local technical transcript of that run and is never sent anywhere or shown over
the network — it stays a local file for your own troubleshooting.

### Running the automated tests

```bash
python3 -B -m unittest discover -s tests -v
```

This runs entirely against a **fake** Claude executable (`tests/fixtures/fake_claude.py`) — it
never calls the real Claude Code CLI and never uses any real usage allowance.

### Validating a report's citations manually

```bash
python3 scripts/check_citations.py <run_id> --root projects/<project-id>
```

This is the same structural check the app itself runs automatically when a project completes
(shown as the "Citation check passed/found issues" badge). It checks structure only — that every
citation number has a matching, well-formed source entry — not whether the underlying claim is
actually true.

### Project folder schema

```
projects/<project-id>/
  project.json           # title, question, approach, selected prompt, scope, planned steps
  sources/README.md      # names of documents you selected — names only, no content
  runs/<run_id>/run.md              # the research's own progress notes
  runs/<run_id>/verification.md     # what was double-checked
  findings/<run_id>/<task>.md, .json   # individual pieces of gathered evidence
  reports/<run_id>.md    # the final report
  state/run.json         # current status, used by the app's interface
  logs/session-<id>.log  # full local technical log (see above)
```

### How Quick and Deep are passed to the research workflow

Your choice is stored as a stable, unambiguous value (`quick` or `deep`) — never re-guessed from
your question's wording — and passed to the research instructions as an explicit prefix, e.g.:

```
mode: quick | <your exact approved prompt>
```

Quick mode uses tighter limits than Deep mode (fewer search/read actions, lighter verification,
narrower scope) — see `.claude/commands/research.md` in the project for the exact ceilings, and
`ui/README.md` for the full technical write-up of exactly how research is launched, including the
precise command-line invocation and the security measures around it.
