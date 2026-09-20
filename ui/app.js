/* Deep Research prototype — plain JS, no framework, no build step.
   Handles navigation between the four screens, a small Markdown renderer with
   clickable citations, and a functional research-brief editor.

   This is a prototype: no network calls, no Claude integration, no document
   processing. Projects and drafts the user creates are saved in this browser
   only (localStorage), not as project folders on disk. */

(function () {
  "use strict";

  var DATA = window.DR_DATA || {};
  var screen = document.getElementById("screen");
  var mainEl = document.getElementById("main");

  // ---------------- storage (safe / feature-detected) ----------------
  var KEYS = { projects: "dr_projects_v1", draft: "dr_draft_v1", introDismissed: "dr_intro_dismissed_v1" };
  var storageOK = (function () {
    try {
      var k = "__dr_test__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();
  function loadJSON(key, fallback) {
    if (!storageOK) return fallback;
    try {
      var raw = window.localStorage.getItem(key);
      if (raw == null) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    if (!storageOK) return false;
    try { window.localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; } // e.g. quota exceeded or private-mode restriction
  }

  // ---------------- app state ----------------
  function newDraft() {
    return {
      step: 1,
      question: "",
      files: [],
      answers: {},
      depth: "Balanced",
      timeframe: "Latest available",
      approach: "quick",      // machine-readable: "quick" | "deep" (Quick is the default)
      prompts: {},            // generated research prompts: { quick, deep }
      promptEdited: {},       // which prompts the user hand-edited (never auto-overwritten)
      brief: null,
      edited: {}              // which brief fields the user hand-edited (never auto-overwritten)
    };
  }
  function normalizeDraft(d) {
    if (!d || typeof d !== "object") return newDraft();
    d.step = d.step || 1;
    d.question = d.question || "";
    d.files = Array.isArray(d.files) ? d.files : [];
    d.answers = d.answers || {};
    d.depth = d.depth || "Balanced";
    d.timeframe = d.timeframe || "Latest available";
    d.approach = (d.approach === "quick" || d.approach === "deep") ? d.approach : "quick";
    d.prompts = d.prompts || {};
    d.promptEdited = d.promptEdited || {};
    d.edited = d.edited || {};
    return d;
  }

  var state = {
    view: "welcome",
    projectId: null,
    projects: (function () { var p = loadJSON(KEYS.projects, []); return Array.isArray(p) ? p : []; })(),
    draft: normalizeDraft(loadJSON(KEYS.draft, null)),
    // Saving is "healthy" only while writes actually succeed. It starts false when
    // storage is unavailable at boot, and flips to false the first time any write
    // fails (e.g. quota). Once unhealthy it stays warned for the session.
    saveHealthy: storageOK,
    // Server connection: only true when this page is being served by the local
    // Python backend (start.py / ui/launch.sh / server/app.py) rather than opened as a
    // plain file. When true, approving a brief creates a REAL project on disk
    // and Start research launches the actual Claude Code CLI. When false
    // (or while still checking), every existing standalone/localStorage
    // behavior is preserved exactly as before — nothing here changes it.
    connected: false,
    serverHealth: null,
    serverProjects: [],
    model: null   // the coordinator model the backend is configured with (e.g. "sonnet")
  };

  // Record the outcome of a write. Never claims success it didn't get; on failure
  // it surfaces a persistent, session-long warning that changes won't survive refresh.
  function reportSave(ok) {
    if (!ok && state.saveHealthy !== false) state.saveHealthy = false;
    updateSaveWarning();
    return ok;
  }
  function persistDraft() { return reportSave(saveJSON(KEYS.draft, state.draft)); }
  function persistProjects() { return reportSave(saveJSON(KEYS.projects, state.projects)); }

  // Persistent warning bar shown whenever saving is not working. Inserted once,
  // just below the prototype banner, and stays until a reload with working storage.
  function updateSaveWarning() {
    var w = document.getElementById("save-warning");
    if (!w) {
      w = el('<div id="save-warning" class="save-warning" role="alert" hidden>' +
        '⚠ Saving is unavailable in this browser, so projects and drafts you create ' +
        'here <strong>will be lost when you refresh or close the tab</strong>. Everything else works for this visit.</div>');
      var banner = document.querySelector(".proto-banner");
      if (banner && banner.parentNode) banner.parentNode.insertBefore(w, banner.nextSibling);
      else document.body.insertBefore(w, document.body.firstChild);
    }
    w.hidden = state.saveHealthy !== false;
  }

  // ---------------- tiny helpers ----------------
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function today() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function draftHasContent(d) {
    if (!d) return false;
    if (d.question && d.question.trim()) return true;
    if (d.files && d.files.length) return true;
    if (d.brief) return true;
    return Object.keys(d.answers || {}).some(function (k) { return (d.answers[k] || "").trim(); });
  }

  // ---------------- Markdown renderer ----------------
  // Supports headings (with slug ids), ordered/unordered lists incl. one level of
  // nesting by indentation, tables, blockquotes, inline code, bold, italic,
  // markdown links, [n] citation chips, and standalone source ("[n] …") lines.
  function renderInline(text) {
    // Inline code is protected with a placeholder before any other inline
    // processing runs, and restored last — otherwise text like `[3]` inside
    // backticks gets its *contents* re-matched by the later bold/link/
    // citation passes (they operate on the string, not the DOM, so a `[3]`
    // sitting inside an already-built <code> span is still plain matchable
    // text) and can turn into a citation link pointing at a source that
    // doesn't exist on the current page.
    var codeSpans = [];
    var s = esc(text);
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      codeSpans.push(c);
      return "CODE" + (codeSpans.length - 1) + "";
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");     // bold
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");               // italic
    // Links: either an external http(s) URL, or a same-page "#anchor" using
    // only the characters slugify() ever generates. Nothing else is ever
    // accepted as a link target here — no javascript:, data:, or other
    // scheme, and no malformed URL, can become a clickable href.
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+|#[a-z0-9][a-z0-9-]*)\)/g, function (_, label, url) {
      if (url.charAt(0) === "#") return '<a href="' + url + '">' + label + "</a>";
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });
    s = s.replace(/\[(\d+)\]/g, function (_, n) {
      return '<a class="cite" href="#src-' + n + '" data-cite="' + n + '">[' + n + "]</a>";
    });
    s = s.replace(/CODE(\d+)/g, function (_, i) { return "<code>" + codeSpans[+i] + "</code>"; });
    return s;
  }

  function slugify(t, used) {
    var base = String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "section";
    var id = base, k = 2;
    while (used[id]) { id = base + "-" + k; k++; }
    used[id] = true;
    return id;
  }

  function renderMarkdown(md) {
    var lines = md.replace(/\r\n/g, "\n").split("\n");
    var out = [];
    var used = {};
    var i = 0;
    var para = [];
    function flushParagraph() {
      if (para.length) { out.push("<p>" + renderInline(para.join(" ")) + "</p>"); para = []; }
    }

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { flushParagraph(); i++; continue; }

      // Source/reference line "[1] …" -> its own block, id="src-1", leading marker
      // rendered as a plain label (not a self-referential citation chip).
      var srcm = /^\s*\[(\d+)\]\s+([\s\S]*)$/.exec(line);
      if (srcm) {
        flushParagraph();
        out.push('<p id="src-' + srcm[1] + '"><span class="src-num">[' + srcm[1] + "]</span> " +
          renderInline(srcm[2].trim()) + "</p>");
        i++; continue;
      }

      var h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        flushParagraph();
        var level = h[1].length;
        var text = h[2].replace(/\s+$/, "");
        out.push("<h" + level + ' id="' + slugify(text, used) + '">' + renderInline(text) + "</h" + level + ">");
        i++; continue;
      }

      if (/^\s*>\s?/.test(line)) {
        flushParagraph();
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out.push("<blockquote>" + renderInline(q.join(" ")) + "</blockquote>");
        continue;
      }

      // Table: header row + dash separator row
      if (line.indexOf("|") !== -1 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        flushParagraph();
        var header = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim() !== "") { rows.push(splitRow(lines[i])); i++; }
        out.push(buildTable(header, rows));
        continue;
      }

      // List block (ordered or unordered, with indentation-based nesting)
      if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
        flushParagraph();
        var items = [];
        while (i < lines.length) {
          var lm = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
          if (lm) {
            items.push({ indent: lm[1].replace(/\t/g, "  ").length, ordered: /\d/.test(lm[2]), text: lm[3] });
            i++;
          } else if (/^\s+\S/.test(lines[i]) && items.length) {
            // continuation of the previous item (indented, strip an inline quote marker)
            items[items.length - 1].text += " " + lines[i].trim().replace(/^>\s?/, "");
            i++;
          } else break;
        }
        out.push(buildList(items));
        continue;
      }

      para.push(line.trim());
      i++;
    }
    flushParagraph();
    return out.join("\n");
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); });
  }
  function buildTable(header, rows) {
    var thead = "<tr>" + header.map(function (c) { return "<th>" + renderInline(c) + "</th>"; }).join("") + "</tr>";
    var tbody = rows.map(function (r) {
      return "<tr>" + r.map(function (c) { return "<td>" + renderInline(c) + "</td>"; }).join("") + "</tr>";
    }).join("");
    return '<div class="table-wrap"><table>' + thead + tbody + "</table></div>";
  }
  // Recursive nested-list builder driven by each item's indentation.
  function buildList(items) {
    var pos = { i: 0 };
    function build(indent) {
      var ordered = items[pos.i].ordered;
      var html = ordered ? "<ol>" : "<ul>";
      while (pos.i < items.length && items[pos.i].indent >= indent) {
        var it = items[pos.i];
        pos.i++;
        var child = "";
        if (pos.i < items.length && items[pos.i].indent > it.indent) child = build(items[pos.i].indent);
        html += "<li>" + renderInline(it.text) + child + "</li>";
        if (pos.i < items.length && items[pos.i].indent < indent) break;
      }
      return html + (ordered ? "</ol>" : "</ul>");
    }
    return items.length ? build(items[0].indent) : "";
  }

  // Turn bare http(s) URLs in already-rendered text nodes into safe links.
  // Only http/https are matched, so no unsafe protocol can slip through.
  function linkifyUrls(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    var re = /https?:\/\/[^\s<>()]+[^\s<>().,;:]/g;
    nodes.forEach(function (tn) {
      var parent = tn.parentNode;
      if (!parent) return;
      var tag = parent.nodeName;
      if (tag === "A" || tag === "CODE") return;
      var text = tn.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var a = document.createElement("a");
        a.setAttribute("href", m[0]);            // regex guarantees http/https only
        a.textContent = m[0];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "src-link";
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      parent.replaceChild(frag, tn);
    });
  }

  // ---------------- reading aids: "back to reading" floating button ----------------
  var readingReturn = null;
  function ensureReturnBtn() {
    if (readingReturn) return readingReturn;
    readingReturn = el('<button class="reading-return" hidden aria-label="Return to where you were reading">↩ Back to reading</button>');
    readingReturn.addEventListener("click", function () {
      if (readingReturn._y != null) window.scrollTo(0, readingReturn._y);
      hideReturn();
      if (readingReturn._focus && readingReturn._focus.focus) {
        try { readingReturn._focus.focus({ preventScroll: true }); } catch (e) { readingReturn._focus.focus(); }
      }
    });
    document.body.appendChild(readingReturn);
    return readingReturn;
  }
  function showReturn(y, focusEl) { var b = ensureReturnBtn(); b._y = y; b._focus = focusEl; b.hidden = false; }
  function hideReturn() { if (readingReturn) readingReturn.hidden = true; }

  // Delegated citation-click handler (works for async-rendered report content).
  screen.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".cite");
    if (!a) return;
    var id = a.getAttribute("href");
    var target = id && screen.querySelector(id);
    if (!target) return;
    e.preventDefault();
    showReturn(window.scrollY, a);   // remember reading position + which chip was clicked
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    setTimeout(function () {
      var r = target.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight) target.scrollIntoView({ block: "center" });
    }, 350);
    target.style.transition = "background .25s";
    var prev = target.style.background;
    target.style.background = "var(--accent-soft)";
    setTimeout(function () { target.style.background = prev; }, 1100);
  });

  // Contextual help links (e.g. "Show me how" beside Start research, "Help"
  // on Failed/Interrupted/Needs attention) — a small, reusable link that
  // jumps straight to the matching section of the in-app How to use page.
  function helpLinkHtml(anchor, label) {
    return '<a href="#" class="help-link" data-anchor="' + esc(anchor) + '">' + esc(label || "Help") + '</a>';
  }
  screen.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".help-link");
    if (!a) return;
    e.preventDefault();
    navTo("help", { anchor: a.getAttribute("data-anchor") });
  });

  // ---------------- navigation ----------------
  function navTo(view, opts) {
    opts = opts || {};
    stopPolling(); // leaving a live-run view must not keep polling in the background
    state.view = view;
    if (opts.projectId !== undefined) state.projectId = opts.projectId;
    hideReturn();
    render();
    document.querySelectorAll(".nav button").forEach(function (b) {
      var v = b.getAttribute("data-nav");
      var current = (v === view) || (view === "workspace" && v === "projects");
      if (current) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (opts.anchor) {
      // Jump to a specific Help section (used by contextual "Help" / "Show me
      // how" links) instead of the usual top-of-page focus.
      var target = document.getElementById(opts.anchor);
      if (target) {
        target.scrollIntoView({ block: "start" });
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        return;
      }
    }
    if (mainEl) mainEl.focus();
    window.scrollTo(0, 0);
  }

  // Header nav. "New research" resumes any in-progress draft rather than wiping it.
  document.querySelectorAll("[data-nav]").forEach(function (b) {
    b.addEventListener("click", function () { navTo(b.getAttribute("data-nav")); });
  });

  // Warn before leaving only when saving is not working AND the user has created
  // something this session that a refresh would lose (a draft in progress, or
  // projects that couldn't be persisted). When saving works, everything is already
  // saved, so there is no nag.
  window.addEventListener("beforeunload", function (e) {
    if (state.saveHealthy !== false) return;
    var atRisk = draftHasContent(state.draft) || (state.projects && state.projects.length);
    if (atRisk) { e.preventDefault(); e.returnValue = ""; }
  });

  function render() {
    clear(screen);
    var node;
    switch (state.view) {
      case "welcome": node = viewWelcome(); break;
      case "projects": node = viewProjects(); break;
      case "new": node = viewNew(); break;
      case "workspace": node = viewWorkspace(); break;
      case "help": node = viewHelp(); break;
      default: node = viewWelcome();
    }
    screen.appendChild(node);
  }

  function storageNote() {
    if (storageOK) {
      return '<p class="small muted">Projects and drafts you create are saved <strong>in this browser only</strong> ' +
        '(local storage) so they survive a refresh — they are not saved as research project folders on disk.</p>';
    }
    return '<div class="msg error" role="status">This browser is blocking local storage, so created projects and drafts ' +
      '<strong>cannot be saved</strong> and will be lost on refresh. Everything still works for this visit.</div>';
  }

  // ================= SCREEN 1: WELCOME =================
  // First-run walkthrough: a short, dismissible introduction shown the first
  // time the app is opened (tracked in localStorage so it does not reappear
  // on later visits), plus an always-available link to bring it back.
  function introDismissed() { return loadJSON(KEYS.introDismissed, false) === true; }
  function dismissIntro() { saveJSON(KEYS.introDismissed, true); }
  function showIntroAgain() { saveJSON(KEYS.introDismissed, false); navTo("welcome"); }

  function introWalkthroughHtml() {
    return '<div class="card" id="intro-walkthrough" style="border-color:var(--accent)">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
      '<h2 style="margin-top:0">Welcome — here is the short version</h2>' +
      '<button class="btn ghost small" id="intro-dismiss" aria-label="Dismiss introduction">✕ Dismiss</button></div>' +
      '<ol style="margin:0 0 12px;padding-left:20px">' +
      '<li>Type a question in plain language on <strong>New research</strong>.</li>' +
      '<li>Pick <strong>Quick</strong> (everyday questions) or <strong>Deep</strong> (decisions where being wrong is costly).</li>' +
      '<li>Review the brief, click <strong>Start research</strong>, and check back on <strong>My research</strong> any time.</li>' +
      '</ol>' +
      '<p class="small muted" style="margin:0">Full detail for every step is on the ' + helpLinkHtml("starting-research", "How to use") + ' page, any time.</p>' +
      '</div>';
  }

  function viewWelcome() {
    var wrap = el('<section class="screen"></section>');
    if (!introDismissed()) {
      var intro = el(introWalkthroughHtml());
      wrap.appendChild(intro);
      intro.querySelector("#intro-dismiss").addEventListener("click", function () {
        dismissIntro();
        intro.remove();
      });
    }
    var body = el('<div></div>');
    body.innerHTML =
      '<h1>Research that shows its work</h1>' +
      '<p class="lead">Ask a real-world question in plain language. Deep Research reads sources, ' +
      'keeps track of what is confirmed versus uncertain, and writes you a readable report with ' +
      'clickable citations — so you can trust it and check it.</p>' +

      (state.connected
        ? '<div class="callout info"><strong>Connected to your local Claude Code.</strong> Approved briefs create ' +
          'real projects and Start research launches the actual research workflow on this machine, using your ' +
          'Claude Code sign-in — it is not a simulation. Selected documents are still names only; they are never ' +
          'uploaded or read. The example projects and the sample report elsewhere in this app remain fictional.</div>'
        : '<div class="callout sim"><strong>You are viewing a prototype.</strong> This is a design preview only. ' +
          'It does not run research, connect to Claude, or read any documents. The example projects and the sample ' +
          'report are fictional, made-up content used only to show how the interface works.</div>') +

      '<div class="grid">' +
        card("🔎", "Ask in plain language", "No jargon required. Describe what you want to know and what decision it will help you make.") +
        card("⚖️", "Confirmed vs. uncertain", "The report clearly separates what the sources prove from what is still an open question.") +
        card("🔗", "Every claim is cited", "Citations are clickable, so you can jump straight to the source behind any statement.") +
      '</div>' +

      '<div class="card">' +
        '<h2>Three quick steps</h2>' +
        '<ul class="checklist">' +
          '<li><span class="n">1</span><div><strong>Start with a question.</strong> Go to <em>New research</em> and type what you want to know — a sentence or two is enough.</div></li>' +
          '<li><span class="n">2</span><div><strong>Answer a few follow-ups.</strong> We suggest short questions to sharpen the request. Skipping them is fine.</div></li>' +
          '<li><span class="n">3</span><div><strong>Review and edit the brief, choose an approach, then start.</strong> ' +
          (state.connected
            ? 'Approving creates a real project; a separate Start research button on its own screen is where research actually begins.'
            : 'You approve a plain-language plan before anything would start. In this prototype, approving opens a simulated workspace.') +
          '</div></li>' +
        '</ul>' +
        '<div class="btn-row">' +
          '<button class="btn" id="w-start">Start a new research project</button>' +
          '<button class="btn secondary" id="w-examples">See example projects</button>' +
        '</div>' +
      '</div>' +

      (state.connected
        ? '<p class="small muted">Connected through the local backend started by <code>start.py</code> or ' +
          '<code>ui/launch.sh</code>. The browser talks only to that local backend; it launches your signed-in ' +
          'Claude Code CLI, which sends the research request and relevant working context to Claude and accesses ' +
          'web sources as needed. No separate API key is used.</p>'
        : '<p class="small muted">No account or setup is needed to explore this prototype. Run ' +
          '<code>python3 start.py</code> (or <code>bash ui/launch.sh</code>) to connect it to your local Claude Code ' +
          'installation and run real research.</p>') +

      '<p class="small"><button class="btn ghost small" id="w-reintro" style="padding-left:0">↩ Show the introduction again</button></p>';

    wrap.appendChild(body);
    body.querySelector("#w-start").addEventListener("click", function () { navTo("new"); });
    body.querySelector("#w-examples").addEventListener("click", function () { navTo("projects"); });
    body.querySelector("#w-reintro").addEventListener("click", showIntroAgain);
    return wrap;
  }

  function card(icon, title, body) {
    return '<div class="card"><div style="font-size:1.6rem" aria-hidden="true">' + icon + '</div>' +
      '<h3>' + esc(title) + '</h3><p class="muted" style="margin:0">' + esc(body) + '</p></div>';
  }

  // ================= SCREEN 2: MY RESEARCH =================
  function viewProjects() {
    var wrap = el('<section class="screen"></section>');
    var head = el(
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">' +
      '<div><h1>My research</h1><p class="lead" style="margin:0">Your projects and their current status. ' +
      'Open one to read the report or see what needs your attention.</p></div>' +
      '<button class="btn" id="p-new">+ Start research</button></div>'
    );
    wrap.appendChild(head);
    head.querySelector("#p-new").addEventListener("click", function () { navTo("new"); });

    var serverSlot = el("<div></div>");
    wrap.appendChild(serverSlot);
    if (state.connected) {
      renderServerProjectsSection(serverSlot, state.serverProjects);
      refreshServerProjects().then(function (list) {
        if (state.view === "projects") renderServerProjectsSection(serverSlot, list);
      });
    }

    wrap.appendChild(el(storageNote()));

    var mine = state.projects || [];
    var examples = DATA.projects || [];

    if (!mine.length && !examples.length && !(state.connected && state.serverProjects.length)) {
      wrap.appendChild(el('<div class="empty"><div class="icon">📭</div><p><strong>No research yet.</strong></p>' +
        '<p>When you start a project it will appear here with its status.</p></div>'));
      return wrap;
    }

    if (mine.length) {
      wrap.appendChild(el('<h2 class="section-title">Your prototype projects <span class="tag">saved in this browser</span></h2>'));
      var g1 = el('<div class="grid"></div>');
      mine.forEach(function (p) { g1.appendChild(userProjectCard(p)); });
      wrap.appendChild(g1);
    }

    wrap.appendChild(el('<h2 class="section-title">Example projects <span class="tag">fictional, for demonstration</span></h2>'));
    var g2 = el('<div class="grid"></div>');
    examples.forEach(function (p) { g2.appendChild(exampleProjectCard(p)); });
    wrap.appendChild(g2);
    return wrap;
  }

  function exampleProjectCard(p) {
    var real = p.report
      ? '<span class="tag" title="Fictional sample content, for demonstration">Sample report</span>'
      : '<span class="tag" title="Illustrative example, not a real run">Simulated example</span>';
    var c = el(
      '<article class="card project-card">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">' +
          '<span class="pill ' + p.status + '">' + esc(p.statusLabel) + '</span>' + real +
        '</div>' +
        '<h3 style="margin:12px 0 0">' + esc(p.title) + '</h3>' +
        '<p class="meta">Updated ' + esc(p.updated) + (p.citations ? ' · ' + p.citations + ' sources' : '') + '</p>' +
        '<p class="muted" style="margin:0">' + esc(p.summary) + '</p>' +
        '<div class="spacer"></div>' +
        '<div class="bar" aria-hidden="true"><span style="width:' + (p.progress || 0) + '%"></span></div>' +
        '<div class="foot">' +
          '<span class="small muted">' + (p.progress || 0) + '% of planned steps</span>' +
          '<button class="btn secondary open-btn">Open</button>' +
        '</div>' +
      '</article>'
    );
    c.querySelector(".open-btn").addEventListener("click", function () { navTo("workspace", { projectId: p.id }); });
    return c;
  }

  function userProjectCard(p) {
    var c = el(
      '<article class="card project-card">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">' +
          '<span class="pill draft">' + esc(p.statusLabel || "Saved · not started") + '</span>' +
          '<span class="tag">Prototype project</span>' +
        '</div>' +
        '<h3 style="margin:12px 0 0">' + esc(p.title) + '</h3>' +
        '<p class="meta">Created ' + esc(p.updated) + '</p>' +
        '<p class="muted" style="margin:0">' + esc(p.question) + '</p>' +
        '<div class="spacer"></div>' +
        '<div class="foot">' +
          '<button class="btn ghost small del-btn">Delete</button>' +
          '<button class="btn secondary open-btn">Open</button>' +
        '</div>' +
      '</article>'
    );
    c.querySelector(".open-btn").addEventListener("click", function () { navTo("workspace", { projectId: p.id }); });
    c.querySelector(".del-btn").addEventListener("click", function () {
      if (!window.confirm("Delete “" + (p.title || "this project") + "”? This prototype project will be removed from this browser.")) return;
      state.projects = state.projects.filter(function (x) { return x.id !== p.id; });
      persistProjects();
      navTo("projects");
    });
    return c;
  }

  // ================= SCREEN 3: NEW RESEARCH (wizard) =================
  function followupSet(d) {
    var q = (d.question || "").toLowerCase();
    var compare = /(compare|best|cheapest|vs\b|versus|which|recommend|buy|budget|under \d)/.test(q);
    return (DATA.followups && (compare ? DATA.followups.compare : DATA.followups.default)) || [];
  }

  function viewNew() {
    var wrap = el('<section class="screen"></section>');
    var top = el('<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<h1 style="margin:0">New research</h1></div>');
    if (draftHasContent(state.draft)) {
      var discard = el('<button class="btn ghost small">Discard draft &amp; start over</button>');
      discard.addEventListener("click", function () {
        if (!window.confirm("Discard this draft and start a new question? Your current answers and brief edits will be cleared.")) return;
        state.draft = newDraft();
        persistDraft();
        navTo("new");
      });
      top.appendChild(discard);
    }
    wrap.appendChild(top);
    wrap.appendChild(stepper(state.draft.step));

    if (state.draft.step === 1) wrap.appendChild(stepQuestion());
    else if (state.draft.step === 2) wrap.appendChild(stepFollowups());
    else if (state.draft.step === 3) wrap.appendChild(stepApproach());
    else wrap.appendChild(stepBrief());
    return wrap;
  }

  function stepper(step) {
    function s(n, label) {
      var cls = "step" + (n === step ? " active" : "") + (n < step ? " done" : "");
      var num = n < step ? "✓" : n;
      return '<div class="' + cls + '"><span class="num">' + num + '</span>' + label + '</div>';
    }
    return el('<div class="stepper" role="list">' +
      s(1, "Your question") + s(2, "Follow-ups") + s(3, "Research approach") + s(4, "Review brief") + '</div>');
  }

  function approachLabel(a) { return a === "deep" ? "Deep research" : "Quick research"; }

  function stepQuestion() {
    var d = state.draft;
    var c = el('<div class="card"></div>');
    c.innerHTML =
      '<label class="field" for="q">What do you want to find out?</label>' +
      '<p class="hint" id="q-hint">Write it the way you would ask a knowledgeable colleague. One or two sentences is plenty.</p>' +
      '<textarea id="q" aria-describedby="q-hint" placeholder="e.g. I want a low-maintenance bike for a flat 10 km city commute — which type should I get and what should I check before buying?"></textarea>' +
      '<div id="q-err"></div>' +

      '<label class="field" for="file">Mention documents you have (optional)</label>' +
      '<p class="hint" id="file-note">Only file <strong>names</strong> are noted — nothing is uploaded, opened, or read. ' +
      'If a document\'s content matters, describe the relevant details in your question above instead.</p>' +
      '<input type="file" id="file" multiple aria-describedby="file-note" />' +
      '<ul class="filelist" id="filelist"></ul>' +

      '<details id="adv"><summary style="cursor:pointer;font-weight:600">Advanced options (optional)</summary>' +
        '<label class="field" for="adv-depth">How deep should we go?</label>' +
        '<select id="adv-depth"><option>Quick answer</option><option>Balanced</option><option>Thorough report</option></select>' +
        '<label class="field" for="adv-time">How current must it be?</label>' +
        '<select id="adv-time"><option>Latest available</option><option>Within the last year</option><option>Any time — background is fine</option></select>' +
      '</details>' +

      '<div class="btn-row">' +
        '<button class="btn" id="q-next">Continue</button>' +
        '<button class="btn ghost" id="q-example">Use the example question</button>' +
      '</div>';

    var ta = c.querySelector("#q");
    ta.value = d.question || "";
    ta.addEventListener("input", function () { d.question = ta.value; persistDraft(); });

    // depth / timeframe are the single source of truth (shared with the brief)
    var depth = c.querySelector("#adv-depth"); depth.value = d.depth;
    depth.addEventListener("change", function () { d.depth = depth.value; if (d.brief) d.brief.depth = depth.value; persistDraft(); });
    var time = c.querySelector("#adv-time"); time.value = d.timeframe;
    time.addEventListener("change", function () { d.timeframe = time.value; if (d.brief) d.brief.timeframe = time.value; persistDraft(); });
    // open the panel if the user previously chose non-default settings
    if (d.depth !== "Balanced" || d.timeframe !== "Latest available") c.querySelector("#adv").open = true;

    var fileInput = c.querySelector("#file");
    var fileList = c.querySelector("#filelist");
    function renderFiles() {
      fileList.innerHTML = "";
      d.files.forEach(function (f, idx) {
        var li = el('<li>📄 <span>' + esc(f) + '</span><button class="btn ghost small rm" aria-label="Remove ' + esc(f) + '">Remove</button></li>');
        li.querySelector(".rm").addEventListener("click", function () { d.files.splice(idx, 1); persistDraft(); renderFiles(); });
        fileList.appendChild(li);
      });
    }
    fileInput.addEventListener("change", function () {
      Array.prototype.forEach.call(fileInput.files, function (f) { d.files.push(f.name); });
      fileInput.value = "";
      persistDraft();
      renderFiles();
    });
    renderFiles();

    // Using the example question only sets the question text; it keeps the user's
    // answers, depth, and timeframe intact.
    c.querySelector("#q-example").addEventListener("click", function () {
      ta.value = DATA.brief ? DATA.brief.question : "";
      d.question = ta.value;
      if (d.brief && !d.edited.question) d.brief.question = ta.value;
      persistDraft();
      ta.focus();
    });

    c.querySelector("#q-next").addEventListener("click", function () {
      var errBox = c.querySelector("#q-err");
      errBox.innerHTML = "";
      if (!d.question || d.question.trim().length < 8) {
        errBox.appendChild(el('<div class="msg error" role="alert">Please describe your question in a bit more detail before continuing.</div>'));
        ta.focus();
        return;
      }
      d.step = 2;
      persistDraft();
      navTo("new");
    });
    return c;
  }

  function stepFollowups() {
    var d = state.draft;
    var set = followupSet(d);

    var c = el('<div class="card"></div>');
    c.innerHTML =
      '<h2 style="margin-top:0">A few optional follow-ups</h2>' +
      '<p class="muted">These help us aim the research and are carried into your brief. Answer what is useful and skip the rest — nothing here is required.</p>' +
      '<div class="callout sim"><strong>Prototype note:</strong> these example follow-up questions are chosen from a fixed list based on ' +
      'keywords in your question. The real app would tailor them to what you asked.</div>' +
      '<div id="fu"></div>' +
      '<div class="btn-row">' +
        '<button class="btn secondary" id="fu-back">Back</button>' +
        '<button class="btn" id="fu-next">Choose research approach</button>' +
      '</div>';

    var fu = c.querySelector("#fu");
    set.forEach(function (question, idx) {
      var key = "a" + idx;
      var block = el('<div style="margin:14px 0"><label class="field" for="' + key + '">' + esc(question) + '</label>' +
        '<input type="text" id="' + key + '" placeholder="Optional" /></div>');
      var input = block.querySelector("input");
      input.value = d.answers[key] || "";
      input.addEventListener("input", function () { d.answers[key] = input.value; persistDraft(); });
      fu.appendChild(block);
    });

    c.querySelector("#fu-back").addEventListener("click", function () { d.step = 1; persistDraft(); navTo("new"); });
    c.querySelector("#fu-next").addEventListener("click", function () { d.step = 3; syncPrompts(d); persistDraft(); navTo("new"); });
    return c;
  }

  // ---- Research-approach prompts (generated locally from the user's inputs) ----
  // Extra context appended to both prompts: timeframe, follow-up answers, document names.
  function promptContext(d) {
    var parts = [];
    if (d.timeframe) parts.push("Timeframe: " + d.timeframe + ".");
    var set = followupSet(d);
    var qa = [];
    set.forEach(function (q, idx) {
      var a = d.answers["a" + idx];
      if (a && a.trim()) qa.push(q + " " + a.trim());
    });
    if (qa.length) parts.push("Extra details from the person asking: " + qa.join(" | ") + ".");
    if (d.files && d.files.length) parts.push("Documents they provided (names only, not yet processed): " + d.files.join(", ") + ".");
    return parts.length ? "\n\nContext:\n- " + parts.join("\n- ") : "";
  }

  // The browser already invokes the research workflow. People accustomed to
  // the terminal may still paste a leading "/research"; remove that command
  // marker from the subject instead of turning it into part of the title and
  // generated prompt.
  function researchQuestionText(value) {
    return (value || "").trim().replace(/^\/research(?:\s+|$)/i, "").trim();
  }

  function generatePrompts(d) {
    var q = researchQuestionText(d.question);
    var ctx = promptContext(d);
    var quick =
      "Give a quick, practical answer to: \"" + q + "\".\n\n" +
      "Keep the scope narrow and focused on the decision. Compare only the main options at a high level — " +
      "group similar options into useful categories instead of listing every minor variant — and highlight " +
      "the few differences that actually affect the choice. Use a small number of strong, recent sources, and " +
      "skip background theory and exhaustive side-by-side detail. Deliver a concise report with a short summary " +
      "table and a clear recommendation, and state plainly anything that remains uncertain." + ctx;
    var deep =
      "Research this thoroughly: \"" + q + "\".\n\n" +
      "Establish the criteria needed to answer the question, then examine the important methods, options, and " +
      "alternatives in enough detail to support a decision. Account for versions, configurations, operating " +
      "conditions, and use cases only when they materially change the answer. Prefer primary sources and support " +
      "important claims with independent evidence; quantify results where the available evidence allows it, and " +
      "investigate contradictions and practical limitations. Break the work into " +
      "several research tasks where that helps, keep evidence records, and verify the key claims. Deliver a detailed " +
      "report with a full comparison, a recommendation, and an explicit section on limitations and remaining uncertainty." + ctx;
    return { quick: quick, deep: deep };
  }

  // Refresh generated prompts to reflect current inputs, preserving any the user edited.
  function syncPrompts(d) {
    if (!d.prompts) d.prompts = {};
    if (!d.promptEdited) d.promptEdited = {};
    var fresh = generatePrompts(d);
    if (!d.promptEdited.quick) d.prompts.quick = fresh.quick;
    if (!d.promptEdited.deep) d.prompts.deep = fresh.deep;
    if (d.approach !== "quick" && d.approach !== "deep") d.approach = "quick";
  }

  var APPROACH_META = {
    quick: [
      "Scope: narrow and practical",
      "Sources: a few strong, recent ones",
      "Report: concise, with a summary table and a recommendation",
      "Checking: light verification of the important claims"
    ],
    deep: [
      "Scope: broad, with detailed comparisons",
      "Sources: primary sources plus independent evidence",
      "Report: detailed, with limitations and uncertainties",
      "Checking: full evidence records and verification"
    ]
  };
  var APPROACH_BLURB = {
    quick: "Best for everyday comparisons and straightforward questions.",
    deep: "Best for technical decisions, expensive purchases, professional work, or questions where a mistake would matter."
  };

  function stepApproach() {
    var d = state.draft;
    syncPrompts(d);

    var c = el('<div class="card"></div>');
    c.innerHTML =
      '<h2 style="margin-top:0">Choose your research approach</h2>' +
      '<p class="muted">We drafted two research prompts from your question and answers. Pick the one that fits, ' +
      'and edit either prompt if you want to change the focus. You can switch or edit again later.</p>' +
      '<div class="callout sim"><strong>Prototype note:</strong> these prompts are written on your device from a ' +
      'simple template — no Claude and no internet are involved. A finished app could use Claude to improve them.</div>' +
      '<fieldset class="approach-grid"><legend class="sr-only">Research approach</legend>' +
        approachCardHtml("quick") + approachCardHtml("deep") +
      '</fieldset>' +
      '<div class="btn-row">' +
        '<button class="btn secondary" id="ap-back">Back</button>' +
        '<button class="btn" id="ap-next">Continue to brief</button>' +
      '</div>';

    function approachCardHtml(key) {
      var title = approachLabel(key);
      var meta = APPROACH_META[key].map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("");
      return '<div class="approach-card" data-approach="' + key + '">' +
        '<label class="approach-head">' +
          '<input type="radio" name="approach" value="' + key + '" />' +
          '<span class="approach-title">' + esc(title) + '</span>' +
        '</label>' +
        '<p class="muted small" style="margin:6px 0 10px">' + esc(APPROACH_BLURB[key]) + '</p>' +
        '<label class="field" for="prompt-' + key + '" style="margin-top:0">Research prompt (editable)</label>' +
        '<textarea id="prompt-' + key + '" class="approach-prompt"></textarea>' +
        '<p class="tag" style="margin:12px 0 4px">Expected depth &amp; report style</p>' +
        '<ul class="approach-meta">' + meta + '</ul>' +
      '</div>';
    }

    // wire each card
    ["quick", "deep"].forEach(function (key) {
      var cardEl = c.querySelector('.approach-card[data-approach="' + key + '"]');
      var radio = cardEl.querySelector('input[type="radio"]');
      var ta = cardEl.querySelector("textarea");
      ta.value = d.prompts[key] || "";
      ta.addEventListener("input", function () { d.prompts[key] = ta.value; d.promptEdited[key] = true; persistDraft(); });
      radio.addEventListener("change", function () { if (radio.checked) selectApproach(key); });
      // clicking the card selects it (but not when interacting with the textarea)
      cardEl.addEventListener("click", function (e) {
        if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
        selectApproach(key);
      });
    });

    function selectApproach(key) {
      d.approach = key;
      persistDraft();
      applySelection();
    }
    function applySelection() {
      ["quick", "deep"].forEach(function (key) {
        var cardEl = c.querySelector('.approach-card[data-approach="' + key + '"]');
        var radio = cardEl.querySelector('input[type="radio"]');
        var on = d.approach === key;
        radio.checked = on;
        cardEl.classList.toggle("selected", on);
        cardEl.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    applySelection();

    c.querySelector("#ap-back").addEventListener("click", function () { d.step = 2; persistDraft(); navTo("new"); });
    c.querySelector("#ap-next").addEventListener("click", function () { d.step = 4; syncBrief(d); persistDraft(); navTo("new"); });
    return c;
  }

  // Auto-derive the brief from current setup (question, depth, timeframe).
  function deriveBrief(d) {
    var base = DATA.brief || {};
    var q = researchQuestionText(d.question);
    var matches = base.question && q.toLowerCase().slice(0, 30) === base.question.toLowerCase().slice(0, 30);
    var scaffold = matches ? base : {
      title: q.length > 60 ? q.slice(0, 57) + "…" : (q || "Untitled research"),
      inScope: "Answer the question above using reliable sources, and clearly separate confirmed facts from open questions.",
      outScope: "Topics not needed to answer the question.",
      tasks: [
        "Clarify what a good answer would need to establish.",
        "Gather evidence from relevant sources.",
        "Cross-check claims and note any disagreements between sources.",
        "Write a readable report with citations."
      ]
    };
    return {
      title: scaffold.title || (q || "Untitled research"),
      question: q,
      timeframe: d.timeframe || "Latest available",
      depth: d.depth || "Balanced",
      inScope: scaffold.inScope || "",
      outScope: scaffold.outScope || "",
      tasks: (scaffold.tasks || []).slice()
    };
  }

  // Merge freshly-derived values into the brief, preserving any field the user
  // hand-edited (tracked in d.edited). depth/timeframe follow setup directly.
  function syncBrief(d) {
    var derived = deriveBrief(d);
    if (!d.brief) { d.brief = derived; return; }
    ["title", "question", "inScope", "outScope"].forEach(function (k) {
      if (!d.edited[k]) d.brief[k] = derived[k];
    });
    if (!d.edited.tasks) d.brief.tasks = derived.tasks.slice();
    d.brief.timeframe = d.timeframe || "Latest available";
    d.brief.depth = d.depth || "Balanced";
  }

  // The context (answers + document names) shown in the brief always reflects setup.
  function briefContext(d) {
    var set = followupSet(d);
    var qa = [];
    set.forEach(function (q, idx) {
      var a = d.answers["a" + idx];
      if (a && a.trim()) qa.push({ q: q, a: a.trim() });
    });
    return { answers: qa, files: (d.files || []).slice(), depth: d.depth, timeframe: d.timeframe };
  }

  function stepBrief() {
    var d = state.draft;
    syncBrief(d);   // keep non-edited fields in step with any setup changes
    syncPrompts(d); // ensure the generated prompts exist and reflect current inputs
    var b = d.brief;

    var c = el('<div class="card"></div>');
    c.innerHTML =
      '<h2 style="margin-top:0">Your research brief</h2>' +
      '<p class="muted">This is the plan the app would follow. Edit anything below, then approve it. ' +
      'You stay in control — nothing starts until you say so.</p>' +
      '<div class="callout info">' + (state.connected
        ? 'Editing here is fully functional. Approving the brief creates a <strong>real project</strong> on this ' +
          'machine. Research does not start automatically — the next screen has a separate Start research button, ' +
          'and starting is the point where your Claude Code allowance is used.'
        : 'Editing here is fully functional. Approving the brief saves the project in this browser and opens a ' +
          '<strong>simulated</strong> workspace — no real research is started.') + '</div>' +

      '<label class="field" for="b-title">Project title</label>' +
      '<input type="text" id="b-title" />' +

      '<label class="field" for="b-q">Question</label>' +
      '<textarea id="b-q" style="min-height:80px"></textarea>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
        '<div><label class="field" for="b-time">How current</label>' +
          '<select id="b-time"><option>Latest available</option><option>Within the last year</option><option>Any time — background is fine</option></select></div>' +
        '<div><label class="field" for="b-depth">Depth</label>' +
          '<select id="b-depth"><option>Quick answer</option><option>Balanced</option><option>Thorough report</option></select></div>' +
      '</div>' +

      '<label class="field">Research approach</label>' +
      '<div class="callout info" style="margin-top:6px" id="b-approach-box"></div>' +
      '<label class="field" for="b-prompt">Selected research prompt</label>' +
      '<p class="hint">This is the prompt that would guide the research. You can edit it here or on the previous step.</p>' +
      '<textarea id="b-prompt" class="approach-prompt"></textarea>' +

      '<label class="field" for="b-in">What is in scope</label>' +
      '<textarea id="b-in" style="min-height:70px"></textarea>' +
      '<label class="field" for="b-out">What is out of scope</label>' +
      '<textarea id="b-out" style="min-height:60px"></textarea>' +

      '<label class="field">Planned steps</label>' +
      '<p class="hint">These become the tasks the app would work through. Edit, remove, or add your own.</p>' +
      '<div id="b-tasks"></div>' +
      '<button class="btn ghost" id="b-addtask">+ Add a step</button>' +

      '<div id="b-context"></div>' +

      '<div id="b-msg"></div>' +
      '<div class="btn-row">' +
        '<button class="btn secondary" id="b-back">Back</button>' +
        '<button class="btn" id="b-approve">Approve brief &amp; save project</button>' +
      '</div>';

    var title = c.querySelector("#b-title"); title.value = b.title || "";
    title.addEventListener("input", function () { b.title = title.value; d.edited.title = true; persistDraft(); });
    var qf = c.querySelector("#b-q"); qf.value = b.question || "";
    qf.addEventListener("input", function () { b.question = qf.value; d.edited.question = true; persistDraft(); });

    var tf = c.querySelector("#b-time"); tf.value = b.timeframe || "Latest available";
    tf.addEventListener("change", function () { d.timeframe = tf.value; b.timeframe = tf.value; persistDraft(); renderContext(); });
    var df = c.querySelector("#b-depth"); df.value = b.depth || "Balanced";
    df.addEventListener("change", function () { d.depth = df.value; b.depth = df.value; persistDraft(); renderContext(); });

    var inf = c.querySelector("#b-in"); inf.value = b.inScope || "";
    inf.addEventListener("input", function () { b.inScope = inf.value; d.edited.inScope = true; persistDraft(); });
    var outf = c.querySelector("#b-out"); outf.value = b.outScope || "";
    outf.addEventListener("input", function () { b.outScope = outf.value; d.edited.outScope = true; persistDraft(); });

    // Selected approach + the final selected prompt (kept in sync with the approach step).
    var promptTa = c.querySelector("#b-prompt");
    var approachBox = c.querySelector("#b-approach-box");
    function renderApproach() {
      approachBox.innerHTML = '<p style="margin:0"><strong>' + esc(approachLabel(d.approach)) + '</strong> ' +
        '<span class="muted">— ' + esc(APPROACH_BLURB[d.approach]) + '</span></p>';
      var change = el('<button class="btn ghost small" style="margin-top:8px">Change approach</button>');
      change.addEventListener("click", function () { d.step = 3; persistDraft(); navTo("new"); });
      approachBox.appendChild(change);
      promptTa.value = d.prompts[d.approach] || "";
    }
    promptTa.addEventListener("input", function () {
      d.prompts[d.approach] = promptTa.value;
      d.promptEdited[d.approach] = true;
      persistDraft();
    });
    renderApproach();

    var tasksBox = c.querySelector("#b-tasks");
    function renderTasks() {
      tasksBox.innerHTML = "";
      b.tasks.forEach(function (t, idx) {
        var row = el('<div class="task-edit">' +
          '<textarea aria-label="Step ' + (idx + 1) + '">' + esc(t) + '</textarea>' +
          '<button class="btn ghost" aria-label="Remove step ' + (idx + 1) + '">Remove</button></div>');
        var ta = row.querySelector("textarea");
        ta.addEventListener("input", function () { b.tasks[idx] = ta.value; d.edited.tasks = true; persistDraft(); });
        row.querySelector("button").addEventListener("click", function () {
          b.tasks.splice(idx, 1); d.edited.tasks = true; persistDraft(); renderTasks();
        });
        tasksBox.appendChild(row);
      });
    }
    renderTasks();
    c.querySelector("#b-addtask").addEventListener("click", function () {
      b.tasks.push(""); d.edited.tasks = true; persistDraft(); renderTasks();
      var areas = tasksBox.querySelectorAll("textarea");
      if (areas.length) areas[areas.length - 1].focus();
    });

    // Context from setup (read-only summary; always reflects current setup)
    var contextBox = c.querySelector("#b-context");
    function renderContext() {
      var cc = briefContext(d);
      var html = '<label class="field">Context from your setup</label>' +
        '<div class="callout info" style="margin-top:6px">' +
        '<p style="margin:0 0 8px"><strong>Depth:</strong> ' + esc(cc.depth) + ' &nbsp;·&nbsp; <strong>How current:</strong> ' + esc(cc.timeframe) + '</p>';
      if (cc.answers.length) {
        html += '<p style="margin:0 0 4px"><strong>Your follow-up answers:</strong></p><ul style="margin:0 0 8px">' +
          cc.answers.map(function (qa) { return '<li>' + esc(qa.q) + ' — <em>' + esc(qa.a) + '</em></li>'; }).join("") + '</ul>';
      } else {
        html += '<p class="small muted" style="margin:0 0 8px">No follow-up answers provided.</p>';
      }
      if (cc.files.length) {
        html += '<p style="margin:0 0 4px"><strong>Documents (names only, not processed):</strong></p><ul style="margin:0">' +
          cc.files.map(function (f) { return '<li>📄 ' + esc(f) + '</li>'; }).join("") + '</ul>';
      } else {
        html += '<p class="small muted" style="margin:0">No documents selected.</p>';
      }
      html += '</div>';
      contextBox.innerHTML = html;
    }
    renderContext();

    c.querySelector("#b-back").addEventListener("click", function () { d.step = 3; persistDraft(); navTo("new"); });
    c.querySelector("#b-approve").addEventListener("click", function () {
      var msg = c.querySelector("#b-msg"); msg.innerHTML = "";
      if (!b.title.trim() || !b.question.trim()) {
        msg.appendChild(el('<div class="msg error" role="alert">A title and a question are needed before approving the brief.</div>'));
        return;
      }
      b.tasks = b.tasks.filter(function (t) { return t.trim() !== ""; });
      var approveBtn = c.querySelector("#b-approve");

      if (state.connected) {
        approveBtn.disabled = true;
        apiFetch("/api/projects", {
          method: "POST",
          body: {
            title: b.title.trim(), question: b.question.trim(), timeframe: b.timeframe, depth: b.depth,
            inScope: b.inScope, outScope: b.outScope, tasks: b.tasks.slice(),
            approach: d.approach, selectedPrompt: d.prompts[d.approach] || "",
            context: briefContext(d)
          }
        }).then(function (data) {
          state.draft = newDraft();
          persistDraft();
          msg.appendChild(el('<div class="msg success" role="status">Brief approved. This is a real project — opening its workspace…</div>'));
          setTimeout(function () { navTo("workspace", { projectId: data.project.id }); }, 500);
        }).catch(function (e) {
          approveBtn.disabled = false;
          msg.appendChild(el('<div class="msg error" role="alert">Could not create the project: ' + esc(e.message) + '</div>'));
        });
        return;
      }

      // Standalone mode (no local backend reachable): unchanged prototype
      // behavior — save the approved brief in this browser only.
      var proj = {
        id: "user-" + Date.now().toString(36),
        kind: "user",
        title: b.title.trim(),
        question: b.question.trim(),
        timeframe: b.timeframe,
        depth: b.depth,
        inScope: b.inScope,
        outScope: b.outScope,
        tasks: b.tasks.slice(),
        context: briefContext(d),
        // Stable machine-readable approach ("quick"/"deep") plus the complete selected
        // prompt, so the choice can later drive the real research workflow.
        approach: d.approach,
        selectedPrompt: d.prompts[d.approach] || "",
        prompts: { quick: d.prompts.quick || "", deep: d.prompts.deep || "" },
        statusLabel: "Saved · not started",
        updated: today(),
        createdAt: new Date().toISOString()
      };
      state.projects.unshift(proj);
      var saved = persistProjects();

      // Only clear the draft once the project is safely saved. If saving failed,
      // keep the draft intact so nothing is silently lost, and warn honestly.
      if (saved) {
        state.draft = newDraft();
        persistDraft();
        msg.appendChild(el('<div class="msg success" role="status">Brief approved and saved in this browser. Opening a simulated workspace…</div>'));
      } else {
        msg.appendChild(el('<div class="msg error" role="alert">Brief approved and kept for this visit, but it <strong>could not be saved</strong> ' +
          '(this browser is blocking storage), so it will be lost on refresh. Your draft has been kept in case you want to try again. Opening a simulated workspace…</div>'));
      }
      setTimeout(function () { navTo("workspace", { projectId: proj.id }); }, 900);
    });
    return c;
  }

  // ================= SCREEN 4: RESEARCH WORKSPACE =================
  function viewWorkspace() {
    var user = (state.projects || []).filter(function (p) { return p.id === state.projectId; })[0];
    if (user) return workspaceForUserProject(user);

    var project = (DATA.projects || []).filter(function (p) { return p.id === state.projectId; })[0];
    if (project) return project.report ? workspaceExampleReport(project) : workspaceSimulated(project);

    // Not a local draft, not a fictional example: if we're connected to the
    // local backend, this is (or might be) a real server-backed project.
    if (state.connected) return workspaceServerProject(state.projectId);

    var e = el('<section class="screen"></section>');
    e.appendChild(el('<div class="empty"><div class="icon">🤔</div><p><strong>That project could not be found.</strong></p>' +
      '<p>It may have been deleted or was a temporary preview.</p></div>'));
    var back = el('<div class="btn-row"><button class="btn secondary">Back to My research</button></div>');
    back.querySelector("button").addEventListener("click", function () { navTo("projects"); });
    e.appendChild(back);
    return e;
  }

  function backBar(label) {
    var bar = el('<div style="margin-bottom:12px"><button class="btn ghost" style="padding-left:0">&larr; ' + esc(label || "Back to My research") + '</button></div>');
    bar.querySelector("button").addEventListener("click", function () { navTo("projects"); });
    return bar;
  }

  function progressList(items) {
    return '<div class="card side-card"><h3 style="margin-top:0">Progress</h3>' +
      '<p class="tag">Simulated</p>' +
      items.map(function (it) {
        return '<div class="progress-item"><span class="dot ' + it.state + '"></span>' +
          '<span class="label">' + esc(it.label) + '<br><span class="sub">' + esc(it.sub) + '</span></span></div>';
      }).join("") + '</div>';
  }

  // Data-driven example workspace: renders a project's (fictional) report plus its
  // simulated progress and attention items from DATA. No hardcoded example specifics.
  function workspaceExampleReport(project) {
    var wrap = el('<section class="screen"></section>');
    wrap.appendChild(backBar());

    wrap.appendChild(el('<div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<span class="pill needs-attention">' + esc(project.statusLabel || "Needs your input") + '</span>' +
      '<span class="tag">Sample report</span></div>' +
      '<h1 style="margin:10px 0 4px">' + esc(project.title) + '</h1>' +
      '<p class="muted" style="margin:0">' + esc(project.question) + '</p></div>'));

    wrap.appendChild(el('<div class="callout sim" style="margin-top:16px"><strong>Fictional sample content.</strong> ' +
      'This whole example — the report, the steps, and the questions — is made up to show how the interface works. ' +
      'It is not real research and its sources are placeholder links.</div>'));

    var grid = el('<div class="work-grid" style="margin-top:16px"></div>');

    var left = el('<div class="work-side"></div>');
    left.innerHTML = progressList(project.progressSteps || []);
    var attn = el('<div class="card" style="margin-top:16px"><h3 style="margin-top:0">Questions needing your attention</h3>' +
      '<p class="small muted">A finished report often needs a few details from you. These are example questions.</p></div>');
    (project.attention || []).forEach(function (a) {
      var box = el('<div class="attn"><h4>' + esc(a.title) + '</h4><p>' + esc(a.body) + '</p>' +
        '<button class="btn secondary small">Answer (disabled in prototype)</button></div>');
      box.querySelector("button").disabled = true;
      attn.appendChild(box);
    });
    left.appendChild(attn);
    grid.appendChild(left);

    var right = el('<div class="work-main"></div>');
    var docCard = el('<div class="card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<h2 style="margin:0">Report</h2>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<span class="pill complete">' + (project.citations || 0) + ' sources cited</span>' +
          '<button class="btn secondary small" id="focus-toggle" aria-pressed="false">Focus reading</button>' +
        '</div>' +
      '</div>' +
      '<p class="small muted">Use the contents to jump between sections. Click any [number] to open its source; a ' +
      '<strong>Back to reading</strong> button then returns you to where you were.</p>' +
      '<div id="toc-slot"></div>' +
      '<div class="doc" id="report-doc"></div></div>');
    right.appendChild(docCard);
    grid.appendChild(right);
    wrap.appendChild(grid);

    // Focus-reading toggle: hides the progress panel, widens the report.
    docCard.querySelector("#focus-toggle").addEventListener("click", function () {
      var on = grid.classList.toggle("focus");
      this.setAttribute("aria-pressed", on ? "true" : "false");
      this.textContent = on ? "Show progress" : "Focus reading";
    });

    // Render the report after insertion, then build the table of contents.
    setTimeout(function () {
      var docEl = wrap.querySelector("#report-doc");
      docEl.innerHTML = renderMarkdown(DATA.reportMarkdown || "");
      linkifyUrls(docEl);
      buildTocInto(wrap.querySelector("#toc-slot"), docEl);
    }, 0);

    return wrap;
  }

  // Compact, collapsible table of contents from the report's H2 sections.
  function buildTocInto(slot, docEl) {
    var heads = docEl.querySelectorAll("h2");
    if (!heads.length) return;
    var details = el('<details class="toc" open><summary>Contents</summary><ol></ol></details>');
    var ol = details.querySelector("ol");
    heads.forEach(function (h) {
      if (!h.id) return;
      var li = el('<li><a href="#' + h.id + '">' + esc(h.textContent) + "</a></li>");
      li.querySelector("a").addEventListener("click", function (e) {
        e.preventDefault();
        h.scrollIntoView({ block: "start" });
      });
      ol.appendChild(li);
    });
    slot.appendChild(details);
  }

  function workspaceSimulated(project) {
    var wrap = el('<section class="screen"></section>');
    wrap.appendChild(backBar());
    wrap.appendChild(el('<div><span class="pill ' + project.status + '">' + esc(project.statusLabel) + '</span>' +
      '<span class="tag" style="margin-left:8px">Simulated example</span>' +
      '<h1 style="margin:10px 0 4px">' + esc(project.title) + '</h1>' +
      '<p class="muted" style="margin:0">' + esc(project.question) + '</p></div>'));

    var grid = el('<div class="work-grid" style="margin-top:16px"></div>');
    var left = el('<div class="work-side"></div>');
    if (project.status === "in-progress") {
      left.innerHTML = progressList([
        { state: "done", label: "Planned the research", sub: "Complete" },
        { state: "done", label: "Found candidate suppliers", sub: "Complete" },
        { state: "active", label: "Reading datasheets & certificates", sub: "In progress" },
        { state: "todo", label: "Compare and shortlist", sub: "Not started" },
        { state: "todo", label: "Write the report", sub: "Not started" }
      ]);
    } else {
      left.innerHTML = progressList([
        { state: "done", label: "Planned the research", sub: "Complete" },
        { state: "done", label: "Gathered sources", sub: "Complete" },
        { state: "done", label: "Wrote the report", sub: "Complete" }
      ]);
    }
    grid.appendChild(left);

    var right = el('<div class="work-main"></div>');
    if (project.status === "in-progress") {
      right.appendChild(el('<div class="card"><div class="callout sim"><strong>Simulated in-progress project.</strong> ' +
        'This example shows what the workspace looks like while research is running. There is no report yet, and nothing is actually running.</div>' +
        '<div class="empty" style="margin-top:8px"><div class="icon">⏳</div><p><strong>In a finished app, the report would appear here when ready.</strong></p></div></div>'));
    } else {
      right.appendChild(el('<div class="card"><div class="callout sim"><strong>Simulated example.</strong> ' +
        'This short example does not include a full rendered report in the prototype.</div>' +
        '<div class="doc"><h2>Answer</h2><p>Example answer text would appear here, with clickable citations, ' +
        'headings, and tables — like the sample report example.</p></div></div>'));
    }
    grid.appendChild(right);
    wrap.appendChild(grid);
    return wrap;
  }

  function workspaceForUserProject(p) {
    var wrap = el('<section class="screen"></section>');
    wrap.appendChild(backBar());
    wrap.appendChild(el('<div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<span class="pill draft">Saved · not started</span><span class="tag">Prototype project</span></div>' +
      '<h1 style="margin:10px 0 4px">' + esc(p.title) + '</h1>' +
      '<p class="muted" style="margin:0">' + esc(p.question) + '</p></div>'));

    wrap.appendChild(el('<div class="callout sim" style="margin-top:16px"><strong>Nothing is actually running.</strong> ' +
      'You approved this brief, so this is the workspace you would land on. In this prototype no real research starts, ' +
      'so the steps below are a plan, not live progress.</div>'));

    var grid = el('<div class="work-grid" style="margin-top:8px"></div>');
    var steps = (p.tasks && p.tasks.length ? p.tasks : ["Plan the research", "Gather sources", "Write the report"]).map(function (t, i) {
      return { state: i === 0 ? "active" : "todo", label: t, sub: i === 0 ? "Would start first" : "Planned" };
    });
    var left = el('<div class="work-side"></div>'); left.innerHTML = progressList(steps);
    grid.appendChild(left);

    var right = el('<div class="work-main"></div>');
    var ctx = p.context || { answers: [], files: [], depth: p.depth, timeframe: p.timeframe };
    var ctxHtml = '<h3 style="margin-top:0">Your approved brief</h3>' +
      '<p><strong>Approach:</strong> ' + esc(approachLabel(p.approach)) + '</p>' +
      '<p><strong>Depth:</strong> ' + esc(ctx.depth || p.depth || "") + ' &nbsp;·&nbsp; <strong>How current:</strong> ' + esc(ctx.timeframe || p.timeframe || "") + '</p>' +
      '<p><strong>In scope:</strong> ' + esc(p.inScope || "") + '</p>' +
      '<p><strong>Out of scope:</strong> ' + esc(p.outScope || "") + '</p>';
    if (p.selectedPrompt) {
      ctxHtml += '<p style="margin-bottom:4px"><strong>Selected research prompt:</strong></p>' +
        '<div class="prompt-quote">' + esc(p.selectedPrompt) + '</div>';
    }
    if (ctx.answers && ctx.answers.length) {
      ctxHtml += '<p style="margin-bottom:4px"><strong>Follow-up answers:</strong></p><ul style="margin-top:0">' +
        ctx.answers.map(function (qa) { return "<li>" + esc(qa.q) + " — <em>" + esc(qa.a) + "</em></li>"; }).join("") + "</ul>";
    }
    if (ctx.files && ctx.files.length) {
      ctxHtml += '<p style="margin-bottom:4px"><strong>Documents (names only, not processed):</strong></p><ul style="margin-top:0">' +
        ctx.files.map(function (f) { return "<li>📄 " + esc(f) + "</li>"; }).join("") + "</ul>";
    }
    ctxHtml += '<div class="empty" style="margin-top:12px"><div class="icon">📝</div>' +
      '<p><strong>A report would appear here once research runs.</strong></p>' +
      '<p>To see what a finished report looks like, open the sample report below.</p></div>';
    right.appendChild(el('<div class="card">' + ctxHtml + '</div>'));

    var seeExample = el('<div class="btn-row"><button class="btn secondary">Open the sample report</button></div>');
    seeExample.querySelector("button").addEventListener("click", function () { navTo("workspace", { projectId: "sample-report" }); });
    right.appendChild(seeExample);
    grid.appendChild(right);
    wrap.appendChild(grid);
    return wrap;
  }

  // ================= SCREEN 5: HOW TO USE (in-app help) =================
  // A condensed, on-page version of the root USER_GUIDE.md, written for
  // someone who has never used a terminal or Claude Code before. Kept as
  // plain Markdown and rendered with the same renderer as reports, so it
  // gets the same table of contents (via buildTocInto) and heading anchors
  // for free — those anchors are what the contextual "Help" / "Show me how"
  // links elsewhere in the app jump to.
  function helpMarkdown() {
    return [
      "# How to use Deep Research",
      "",
      "A plain-language guide to this app. The full version of this guide, with more detail on " +
        "installing and updating, is also in the project as `USER_GUIDE.md`.",
      "",
      "## What this app does",
      "",
      "This app turns a rough question into a proper research brief, runs the research " +
        (state.connected ? "using your own local Claude Code installation" : "(when connected to Claude Code — see below)") +
        ", shows you real progress, pauses to ask when it genuinely needs your input, and gives " +
        "you back a report with clickable citations. It cannot promise an exact finish time, that " +
        "it saw every possible source, or that its conclusions are certain — read a report the way " +
        "you'd read any research someone handed you.",
      "",
      (state.connected
        ? "This copy of the app is **connected** to your local Claude Code — approving a brief creates a real project, and Start research runs real research."
        : "This copy of the app is in **standalone preview mode** — no backend is connected, so example content is shown and nothing here runs real research. Launch it with `python3 start.py` (or `bash ui/launch.sh`) from a terminal to connect it."),
      "",
      "## Starting research",
      "",
      "1. Click **New research**.",
      "2. Describe your question in ordinary language — a sentence or two is enough.",
      "3. Optionally mention documents you have — only their *names* are recorded, nothing is " +
        "uploaded or read (see [Project files and privacy](#project-files-and-privacy)).",
      "4. Open **Advanced options** to set a timeframe, if useful. Optional.",
      "5. Continue, and answer any follow-up questions that are useful — all optional, skip freely.",
      "6. On **Research approach**, compare the Quick and Deep prompts (see below) and pick one.",
      "7. Edit the chosen prompt if you want to sharpen the focus.",
      "8. Review the final brief and edit anything that isn't quite right.",
      "9. Approve it, then click **Start research** on the next screen — which also shows the " +
        "model Claude Code will run as, before anything starts.",
      "10. Leave the app open, or come back later — check **My research** any time.",
      "",
      "## Quick versus Deep research",
      "",
      "| | Quick research | Deep research |",
      "|---|---|---|",
      "| Best for | Everyday comparisons, straightforward questions, early exploration | Technical/engineering decisions, expensive purchases, conflicting evidence |",
      "| Scope | Narrow — the main options, at a practical level | Broad — detailed comparisons and alternatives |",
      "| Sources | A few strong, recent sources | Primary sources plus independent evidence |",
      "| Checking | Cites sources, checks important claims | Full evidence records and a verification pass |",
      "| Report | Concise, with a table and a recommendation | Detailed, with limitations spelled out |",
      "",
      "Example: *\"Should I get an Intel Core i5 or i7?\"* is an ordinary purchase — **Quick** fits. " +
        "*\"Evaluate PCB insertion-loss simulation vs. measurement for this real hardware design\"* " +
        "is a technical decision with real consequences — **Deep** fits. Neither mode promises an " +
        "exact duration or cost, and Quick will say so plainly and suggest Deep rather than quietly " +
        "stretching past its own limits if a question turns out to need more.",
      "",
      "## Following progress",
      "",
      "Every project is in exactly one state, always reflecting what's actually saved on disk — " +
        "never a simulated percentage:",
      "",
      "- **Ready to start** — approved, not yet running. Click Start research.",
      "- **Starting…** — the research process is being launched.",
      "- **Researching** — actively running; a short real activity list updates automatically. A " +
        "**Stop research** button is available here — it preserves everything done so far so you " +
        "can Resume later.",
      "- **Needs attention** — needs information from you, or could not access the evidence required to answer. " +
        "Open it to answer or resume as appropriate.",
      "- **Completed** — a report was written and its citations passed an independent structural check.",
      "- **Completed — with warnings** — a report was written, but research ended with a material " +
        "uncertainty or budget limit, the structural citation check found an issue, or the check could not run. The report " +
        "is still shown. A budget-limited run offers **Continue research** for one additional bounded pass; " +
        "a citation repair button appears only when a structural issue was actually found.",
      "- **Failed** — did not finish; read the error message shown. If a saved Claude session exists, " +
        "the screen also offers **Try resuming** after you correct the problem.",
      "- **Interrupted — resumable** — stopped partway (a usage limit, temporary internet/DNS/API " +
        "failure, you clicking Stop, or the app/computer closing); click Resume research to continue.",
      "",
      "## Answering questions from the agent",
      "",
      "When research can't responsibly continue without something only you know, a project shows " +
        "**Needs attention** with its own saved notes explaining what's missing. Type your answer " +
        "into the **Add clarification** box right there and click **Continue research** — this " +
        "resumes the same conversation with your answer, it does not start over. Good answers are " +
        "specific: the exact component model or revision, your budget, whether you already have a " +
        "stack-up or schematic, the required frequency range, or whether a datasheet is available. " +
        "Specific detail like this can materially improve the answer. (If a project has no " +
        "resumable session recorded — rare — the screen says so and starting a fresh project with " +
        "the detail included is the only option.)",
      "",
      "If evidence access itself was blocked, Needs attention shows the blocked-run record and a " +
        "**Resume research** button instead. It does not ask you for unrelated clarification.",
      "",
      "## Reading the report",
      "",
      "A finished report has a summary and recommendation, confirmed facts labeled separately from " +
        "inference, a limitations section, comparison tables, and numbered citations like `[3]`. " +
        "**Click a citation number** to jump to its source; a **Back to reading** button then " +
        "returns you to exactly where you were. Longer reports also show a table of contents built " +
        "from the report's own headings. If a report says something was **not found**, that means " +
        "this research pass didn't turn it up — not that it's confirmed false or absent everywhere.",
      "",
      "## Project files and privacy",
      "",
      "Each project lives in its own folder on your computer, `projects/<project-id>/`, holding " +
        "your request, source names, progress notes, gathered evidence, verification results, the " +
        "final report, and a local log. The app itself only ever listens on `127.0.0.1` (your own " +
        "computer) — but doing research does send your question and findings to Claude, and fetches " +
        "relevant web pages, since that's what research requires. Browser-started Claude has no " +
        "general command shell or unrelated account connectors, but its file permissions cover this " +
        "repository as a whole. Keeping writes inside the chosen project folder is a workflow rule, " +
        "not a separate operating-system sandbox, so treat the app folder as a trusted workspace. " +
        "**Documents you select are not " +
        "processed** — only their file names are recorded, nothing is uploaded or read. Clearing " +
        "your browser's storage only affects draft questions in standalone preview mode — it never " +
        "touches real project folders. To remove a real project, open it and use **Remove this " +
        "project** at the bottom of the page — it moves the folder into a local, recoverable trash " +
        "location rather than deleting it outright, and its log may contain your question, sources, " +
        "and Claude's output, so remove it if you no longer want that kept.",
      "",
      "## Pausing, resuming, and failures",
      "",
      "- **You click Stop research** → the run stops within a few seconds (asked nicely first, then " +
        "forced only if needed) and becomes Interrupted — resumable, with everything done so far " +
        "kept. Click Resume any time to continue.",
      "- **Usage allowance runs out** → the project becomes Interrupted — resumable; click Resume " +
        "later to continue the same conversation, not start over.",
      "- **Internet, DNS, or the connection to Claude fails temporarily** → the project becomes " +
        "Interrupted — resumable; restore the connection and click **Resume research**. Completed " +
        "work and the same Claude session are preserved.",
      "- **You close the app normally (Ctrl+C in its terminal) while research is running** → it " +
        "stops the research process before exiting, the same as clicking Stop. This is only " +
        "guaranteed for a normal, graceful shutdown — an unavoidable hard kill (e.g. `kill -9`, " +
        "closing the terminal window's process abruptly, or the computer losing power) gives no " +
        "program, including this one, any chance to clean up, so that case is not guaranteed.",
      "- **The app or your computer closes/crashes unexpectedly mid-run** → reopening the app " +
        "corrects the status to Interrupted — resumable if a session was already recorded.",
      "- **A permission Claude would need isn't already granted** → that specific action is safely " +
        "declined; a fixed, narrow set of actions is pre-approved for unattended research, and it " +
        "does not include a general command shell.",
      "- **A source can't be opened** → recorded as a gap in the evidence, not treated as proof of " +
        "anything.",
      "- **All evidence access is blocked** → the project becomes **Needs attention**, preserves its " +
        "plan and session, and offers **Resume research** after the access problem is fixed; a saved " +
        "failure explanation is never labeled as a completed answer.",
      "- **Real uncertainty remains at the end** → the report says so plainly; consider re-running " +
        "in Deep mode.",
      "- **The research budget is exhausted** → the report remains available with a warning. Click " +
        "**Continue research** for one additional bounded pass focused on unfinished checks. This " +
        "preserves the same session and existing evidence, and uses more Claude allowance.",
      "- **A report fails its automatic citation check** → the project becomes **Completed — with " +
        "warnings** rather than an ordinary Completed; the report is still shown, and you can ask " +
        "Claude to fix the specific issue found.",
      "- **The citation check cannot run** → the project also becomes **Completed — with warnings**, " +
        "but no repair button is shown because no structural defect was identified; the screen shows " +
        "whether the checker was missing, timed out, or could not start.",
      "",
      "## Troubleshooting",
      "",
      "| Problem | Try this |",
      "|---|---|",
      "| Browser can't connect | Re-check the address printed in the terminal when you ran the launcher |",
      "| \"Claude Code CLI is not available\" | Install Claude Code, then restart the app |",
      "| \"Claude Code is not signed in\" | Run `claude auth login` in a terminal |",
      "| \"another research run is already active\" | Only one run is allowed at a time — wait for it, or open it to see its status |",
      "| Project shows Needs attention | Open it and follow the displayed action: answer its question, or resume after fixing evidence access |",
      "| Usage limit reached | Wait for it to reset, then click Resume |",
      "| Can't reach the API server / EAI_AGAIN | Restore internet or DNS, reopen the project, then click Resume research |",
      "| Recoverable interruption still says Failed | Restart the updated app and reopen the project; older saved states are repaired automatically, and Failed projects with a saved session offer Try resuming |",
      "| No report on a Completed project | Check that project's log file (see `USER_GUIDE.md`, Advanced section) |",
      "| Citation link does nothing | That report likely has a structural issue; look for a Completed — with warnings state |",
      "| Project shows Completed — with warnings | Follow the action shown: **Continue research** for an exhausted research budget, **Ask Claude to fix this** for a citation defect, or read the limitation when no automatic action applies |",
      "| Citation check unavailable | The report exists, but its citation structure was not validated; read the reason shown and retry after fixing the local checker |",
      "| Can't remove a project | Research must be stopped first; the confirmation text must exactly match the project's title |",
      "",
      "For full installation and update instructions, the exact command-line details, and the " +
        "project folder schema, see `USER_GUIDE.md` in the project's main folder."
    ].join("\n");
  }

  function viewHelp() {
    var wrap = el('<section class="screen"></section>');
    wrap.appendChild(el('<h1>How to use</h1>'));
    wrap.appendChild(el('<p class="lead">Short, scannable sections — use the contents below to jump straight to what you need.</p>'));
    var tocSlot = el("<div></div>");
    wrap.appendChild(tocSlot);
    var doc = el('<div class="doc card"></div>');
    doc.innerHTML = renderMarkdown(helpMarkdown());
    wrap.appendChild(doc);
    buildTocInto(tocSlot, doc);
    return wrap;
  }

  // ================= SERVER API CLIENT =================
  // Talks only to this same-origin local backend (server/app.py). Never used
  // when the page is opened as a plain file (fetch to a relative /api/...
  // URL fails immediately under file://, which is how standalone mode is
  // detected — see checkConnected()). All requests are same-origin fetches;
  // no credentials, tokens, or third-party endpoints are ever involved.
  function apiFetch(path, opts) {
    opts = opts || {};
    var controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, opts.timeout || 15000) : null;
    return fetch(path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    }).then(function (resp) {
      if (timer) clearTimeout(timer);
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) {
          var err = new Error((data && data.error) || ("Request failed (" + resp.status + ")"));
          err.status = resp.status;
          throw err;
        }
        return data;
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  function checkConnected() {
    return apiFetch("/api/health", { timeout: 1800 }).then(function (data) {
      state.connected = true;
      state.serverHealth = data.claude || null;
      state.model = data.model || null;
      updateChromeForConnection();
      return true;
    }).catch(function () {
      // Standalone mode (opened as a plain file, or no backend reachable):
      // the page shell starts with neutral "checking…" text specifically so
      // it never has to show a wrong claim while this resolves — update it
      // here too, not only on the connected branch above.
      state.connected = false;
      state.serverHealth = null;
      state.model = null;
      updateChromeForConnection();
      return false;
    });
  }

  // Updates the parts of the page shell that exist outside the render()
  // cycle (the top banner and footer) so they never contradict connected
  // mode — the persistent "no research is actually run" claim only holds
  // in standalone mode.
  function updateChromeForConnection() {
    var banner = document.getElementById("proto-banner");
    if (banner) {
      banner.textContent = state.connected
        ? "Connected to your local Claude Code · Real projects run real research · Selected documents are still names only, never uploaded"
        : "Prototype preview · Example content is simulated · No research is actually run and no documents are processed";
    }
    var foot = document.getElementById("app-foot");
    if (foot) {
      foot.innerHTML = state.connected
        ? "Deep Research · Connected to your local Claude Code CLI. The local interface launches Claude Code, " +
          "which communicates with Claude and relevant web sources using your existing sign-in; no separate API " +
          "key is used. The example projects and the sample report elsewhere in this " +
          "app are still <strong>fictional, made-up content</strong>."
        : "Deep Research prototype · This is a design preview to explore the experience. It does not connect to Claude, " +
          "call any paid service, or start real research. The example projects and the sample report are " +
          "<strong>fictional, made-up content</strong> used only to demonstrate the interface; their sources are placeholder links.";
    }
  }

  function refreshServerProjects() {
    if (!state.connected) { state.serverProjects = []; return Promise.resolve([]); }
    return apiFetch("/api/projects").then(function (data) {
      state.serverProjects = (data && data.projects) || [];
      return state.serverProjects;
    }).catch(function () { state.serverProjects = []; return []; });
  }

  // Human-readable labels/pill classes for the real, server-reported states.
  var SERVER_STATUS_META = {
    "ready": { label: "Ready to start", pill: "draft" },
    "starting": { label: "Starting…", pill: "in-progress" },
    "researching": { label: "Researching", pill: "in-progress" },
    "needs-attention": { label: "Needs attention", pill: "needs-attention" },
    "completed": { label: "Completed", pill: "complete" },
    "completed-with-warnings": { label: "Completed — with warnings", pill: "needs-attention" },
    "failed": { label: "Failed", pill: "failed" },
    "interrupted": { label: "Interrupted — resumable", pill: "needs-attention" }
  };
  function serverStatusMeta(status) { return SERVER_STATUS_META[status] || { label: status || "Unknown", pill: "draft" }; }

  function serverProjectCard(p) {
    var meta = serverStatusMeta(p.status);
    var summary = (p.question || "").replace(/\s+/g, " ").trim();
    if (summary.length > 150) summary = summary.slice(0, 147).trimEnd() + "…";
    var c = el(
      '<article class="card project-card">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">' +
          '<span class="pill ' + meta.pill + '">' + esc(meta.label) + '</span>' +
          '<span class="tag" title="Runs your local Claude Code CLI">Real project</span>' +
        '</div>' +
        '<h3 class="project-card-title">' + esc(p.title) + '</h3>' +
        '<p class="meta">Updated ' + esc((p.updatedAt || "").slice(0, 10)) + ' &middot; ' + esc(approachLabel(p.approach)) + '</p>' +
        '<p class="muted project-card-summary" title="' + esc(p.question || "") + '">' + esc(summary) + '</p>' +
        '<div class="spacer"></div>' +
        '<div class="foot"><span></span><button class="btn secondary open-btn">Open</button></div>' +
      '</article>'
    );
    c.querySelector(".open-btn").addEventListener("click", function () { navTo("workspace", { projectId: p.id }); });
    return c;
  }

  function renderServerProjectsSection(slot, list) {
    slot.innerHTML = "";
    if (!list || !list.length) return;
    slot.appendChild(el('<h2 class="section-title">Your research <span class="tag">runs your local Claude Code</span></h2>'));
    var g = el('<div class="grid"></div>');
    list.forEach(function (p) { g.appendChild(serverProjectCard(p)); });
    slot.appendChild(g);
  }

  // ---------------- server-backed research workspace ----------------
  var pollTimer = null;
  function stopPolling() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

  function workspaceServerProject(pid) {
    var wrap = el('<section class="screen"></section>');
    wrap.appendChild(backBar());
    var slot = el('<div id="server-ws-slot"><p class="muted">Loading…</p></div>');
    wrap.appendChild(slot);
    loadAndRenderServerProject(pid, slot);
    return wrap;
  }

  function loadAndRenderServerProject(pid, slot) {
    apiFetch("/api/projects/" + encodeURIComponent(pid)).then(function (data) {
      if (state.view !== "workspace" || state.projectId !== pid) return; // navigated away
      renderServerProject(data.project, slot);
    }).catch(function (e) {
      if (state.view !== "workspace" || state.projectId !== pid) return;
      slot.innerHTML = '<div class="msg error" role="alert">Could not load this project: ' + esc(e.message) + '</div>';
    });
  }

  // A safe, explicit-confirmation Remove action: the user must re-type the
  // project's own title (checked here, and again by the backend — never
  // trusted from the client alone) before anything happens. Refused while
  // the project is the active run (the backend enforces this too).
  function renderRemoveSection(p) {
    var active = p.status === "starting" || p.status === "researching";
    var box = el('<div class="card" style="margin-top:16px"><h3 style="margin-top:0">Remove this project</h3></div>');
    if (active) {
      box.appendChild(el('<p class="small muted">Stop research before removing this project.</p>'));
      return box;
    }
    box.appendChild(el('<p class="small muted">Moves it to a local, recoverable trash folder — it is not ' +
      'deleted outright. Its log may contain your question, sources, and Claude\'s output, so remove it if ' +
      'you no longer want that kept.</p>'));
    var toggle = el('<button class="btn ghost small">Remove…</button>');
    box.appendChild(toggle);
    var form = el('<div hidden></div>');
    form.innerHTML =
      '<label class="field" for="remove-confirm">Type the project title to confirm: <strong>' + esc(p.title) + '</strong></label>' +
      '<input type="text" id="remove-confirm" autocomplete="off" />' +
      '<div id="remove-msg"></div>' +
      '<div class="btn-row"><button class="btn" id="remove-confirm-btn" disabled>Remove project</button> ' +
      '<button class="btn ghost small" id="remove-cancel-btn">Cancel</button></div>';
    box.appendChild(form);
    toggle.addEventListener("click", function () {
      toggle.hidden = true;
      form.hidden = false;
      form.querySelector("#remove-confirm").focus();
    });
    var input = form.querySelector("#remove-confirm");
    var confirmBtn = form.querySelector("#remove-confirm-btn");
    input.addEventListener("input", function () { confirmBtn.disabled = input.value !== p.title; });
    form.querySelector("#remove-cancel-btn").addEventListener("click", function () {
      form.hidden = true;
      toggle.hidden = false;
      input.value = "";
      confirmBtn.disabled = true;
    });
    confirmBtn.addEventListener("click", function () {
      confirmBtn.disabled = true;
      var msg = form.querySelector("#remove-msg");
      msg.innerHTML = "";
      apiFetch("/api/projects/" + encodeURIComponent(p.id) + "/remove", { method: "POST", body: { confirmTitle: input.value } })
        .then(function () { navTo("projects"); })
        .catch(function (e) {
          confirmBtn.disabled = false;
          msg.appendChild(el('<div class="msg error" role="alert">' + esc(e.message) + '</div>'));
        });
    });
    return box;
  }

  function renderServerProject(p, slot) {
    slot.innerHTML = "";
    var meta = serverStatusMeta(p.status);

    slot.appendChild(el('<div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<span class="pill ' + meta.pill + '">' + esc(meta.label) + '</span>' +
      '<span class="tag" title="Runs your local Claude Code CLI">Real project</span></div>' +
      '<h1 style="margin:10px 0 4px">' + esc(p.title) + '</h1>' +
      '<p class="muted" style="margin:0">' + esc(p.question) + '</p></div>'));

    var grid = el('<div class="work-grid" style="margin-top:16px"></div>');
    var left = el('<div class="work-side"></div>');
    var right = el('<div class="work-main"></div>');

    // -- left: brief summary + approach/prompt (always shown) --
    var briefHtml = '<div class="card side-card"><h3 style="margin-top:0">Approved brief</h3>' +
      '<p><strong>Approach:</strong> ' + esc(approachLabel(p.approach)) + '</p>' +
      '<p><strong>Depth:</strong> ' + esc(p.depth || "") + ' &nbsp;·&nbsp; <strong>How current:</strong> ' + esc(p.timeframe || "") + '</p>';
    if (state.model) briefHtml += '<p><strong>Model:</strong> ' + esc(state.model) + '</p>';
    if (p.inScope) briefHtml += '<p><strong>In scope:</strong> ' + esc(p.inScope) + '</p>';
    if (p.outScope) briefHtml += '<p><strong>Out of scope:</strong> ' + esc(p.outScope) + '</p>';
    var ctxFiles = (p.context && p.context.files) || [];
    if (ctxFiles.length) {
      briefHtml += '<p style="margin-bottom:4px"><strong>Documents mentioned</strong> ' +
        '<span class="small muted">(names only, never uploaded or read)</span>:</p><ul style="margin-top:0">' +
        ctxFiles.map(function (f) { return "<li>📄 " + esc(f) + "</li>"; }).join("") + "</ul>";
    }
    briefHtml += '<p style="margin-bottom:4px"><strong>Prompt:</strong></p><div class="prompt-quote">' + esc(p.selectedPrompt || "") + '</div></div>';
    left.appendChild(el(briefHtml));
    left.appendChild(renderRemoveSection(p));
    grid.appendChild(left);
    grid.appendChild(right);
    slot.appendChild(grid);

    if (p.status === "ready") return renderReadyState(p, right);
    if (p.status === "starting" || p.status === "researching") return renderRunningState(p, right, left);
    if (p.status === "needs-attention") return renderNeedsAttentionState(p, right);
    if (p.status === "completed" || p.status === "completed-with-warnings") return renderCompletedState(p, right);
    if (p.status === "failed") return renderFailedState(p, right);
    if (p.status === "interrupted") return renderInterruptedState(p, right);
    right.appendChild(el('<div class="card"><p class="muted">Unknown status: ' + esc(p.status) + '</p></div>'));
  }

  function renderReadyState(p, right) {
    var card = el('<div class="card">' +
      '<h2 style="margin-top:0">Ready to start</h2>' +
      '<p class="muted">Review the approach and prompt on the left, then start research.</p>' +
      '<div class="callout info"><strong>Starting will use your Claude Code allowance</strong> (the same ' +
      'subscription/session you use in the terminal)' + (state.model ? ', running as the <strong>' + esc(state.model) +
          '</strong> model' : '') + '. The local backend sends the request and relevant working context through ' +
          'Claude Code to Claude and accesses web sources as needed. The workflow is instructed to keep its research ' +
          'files under this project’s folder; current Claude Code file permissions are repository-wide rather than an ' +
          'OS-level per-project sandbox. Use this app folder as a trusted workspace. Only one research run can be ' +
          'active at a time.</div>' +
      '<div id="start-msg"></div>' +
      '<div class="btn-row"><button class="btn" id="start-btn">Start research</button>' +
      helpLinkHtml("starting-research", "Show me how →") + '</div>' +
      '</div>');
    right.appendChild(card);
    var btn = card.querySelector("#start-btn");
    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "Starting…";
      var msg = card.querySelector("#start-msg");
      msg.innerHTML = "";
      apiFetch("/api/projects/" + encodeURIComponent(p.id) + "/start", { method: "POST", body: {} })
        .then(function () { loadAndRenderServerProject(p.id, document.getElementById("server-ws-slot")); })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = "Start research";
          msg.appendChild(el('<div class="msg error" role="alert">' + esc(e.message) + '</div>'));
        });
    });
  }

  function renderRunningState(p, right, left) {
    var card = el('<div class="card">' +
      '<h2 style="margin-top:0">' + (p.status === "starting" ? "Starting…" : "Researching") + '</h2>' +
      '<p class="muted">This is live status from the actual run — not simulated. It updates automatically.</p>' +
      '<div id="phase-slot"></div>' +
      '<h3>Recent activity</h3><div id="activity-slot" class="progress-item-list"></div>' +
      '<div id="stop-msg"></div>' +
      '<div class="btn-row"><button class="btn secondary" id="stop-btn">Stop research</button></div>' +
      '<p class="small muted" style="margin-top:6px">Stopping preserves everything done so far — you can ' +
      'Resume the same run afterward.</p>' +
      '</div>');
    right.appendChild(card);
    renderPhase(p, card.querySelector("#phase-slot"));
    renderActivity(p, card.querySelector("#activity-slot"));
    var stopBtn = card.querySelector("#stop-btn");
    stopBtn.addEventListener("click", function () {
      stopBtn.disabled = true;
      stopBtn.textContent = "Stopping…";
      var msg = card.querySelector("#stop-msg");
      msg.innerHTML = "";
      apiFetch("/api/projects/" + encodeURIComponent(p.id) + "/stop", { method: "POST", body: {} })
        .then(function () { loadAndRenderServerProject(p.id, document.getElementById("server-ws-slot")); })
        .catch(function (e) {
          stopBtn.disabled = false;
          stopBtn.textContent = "Stop research";
          msg.appendChild(el('<div class="msg error" role="alert">' + esc(e.message) + '</div>'));
        });
    });
    var attn = el('<div class="card side-card" style="margin-top:16px"><h3 style="margin-top:0">Progress</h3>' +
      '<p class="tag">Live</p><p class="small muted">Task status shown here comes from the run’s own saved ' +
      'notes (left panel and phase above), not a simulated checklist.</p></div>');
    left.appendChild(attn);
    stopPolling();
    pollTimer = setTimeout(function () {
      if (state.view === "workspace" && state.projectId === p.id) {
        loadAndRenderServerProject(p.id, document.getElementById("server-ws-slot"));
      }
    }, 2000);
  }

  function renderPhase(p, slotEl) {
    if (!p.runMarkdown) {
      slotEl.appendChild(el('<p class="small muted">Waiting for the first checkpoint to be saved…</p>'));
      return;
    }
    var doc = el('<div class="doc"></div>');
    doc.innerHTML = renderMarkdown(p.runMarkdown);
    slotEl.appendChild(doc);
  }

  function renderActivity(p, slotEl) {
    var items = p.activity || [];
    if (!items.length) {
      slotEl.appendChild(el('<p class="small muted">No activity recorded yet.</p>'));
      return;
    }
    items.slice(-12).reverse().forEach(function (a) {
      slotEl.appendChild(el('<div class="progress-item"><span class="dot active"></span>' +
        '<span class="label">' + esc(a.label) + '<br><span class="sub">' + esc(a.time) + '</span></span></div>'));
    });
  }

  function renderNeedsAttentionState(p, right) {
    var evidenceBlocked = p.stopReason === "inaccessible_evidence";
    var card = el('<div class="card">' +
      '<h2 style="margin-top:0">Needs your attention</h2>' +
      '<p class="muted">' + (evidenceBlocked
        ? 'The run could not access the evidence sources it needed, so it did not produce a real answer. Its saved notes are below. '
        : 'The run stopped before producing a report — usually because it needs clarification from you. Its own saved notes are below. ') +
      helpLinkHtml(evidenceBlocked ? "pausing-resuming-and-failures" : "answering-questions-from-the-agent",
        evidenceBlocked ? "What happened?" : "How do I answer this?") + '</p>' +
      (p.error ? '<div class="callout sim"><strong>Details:</strong> ' + esc(p.error) + '</div>' : '') + '</div>');
    right.appendChild(card);
    if (p.runMarkdown) {
      var doc = el('<div class="card"><h3 style="margin-top:0">Saved run notes</h3><div class="doc" id="attn-doc"></div></div>');
      right.appendChild(doc);
      doc.querySelector("#attn-doc").innerHTML = renderMarkdown(p.runMarkdown);
    }

    if (evidenceBlocked) {
      if (p.reportMarkdown) {
        var blockedReport = el('<div class="card"><h3 style="margin-top:0">Blocked-run record</h3>' +
          '<p class="small muted">This explains the failed attempt; it is not a research answer.</p>' +
          '<div class="doc" id="blocked-report-doc"></div></div>');
        right.appendChild(blockedReport);
        blockedReport.querySelector("#blocked-report-doc").innerHTML = renderMarkdown(p.reportMarkdown);
      }
      if (!p.sessionId) {
        right.appendChild(el('<div class="card"><h3 style="margin-top:0">Try again with web access</h3>' +
          '<p class="muted">This project has no previous Claude session recorded, so this exact run cannot ' +
          'be resumed. Start a new research project with the same question; new runs pre-approve the app\'s ' +
          'restricted WebSearch and WebFetch tools.</p></div>'));
        return;
      }
      var resumeCard = el('<div class="card"><h3 style="margin-top:0">Try again with web access</h3>' +
        '<p class="hint">Resume continues this same research session and preserves its plan. The app now ' +
        'pre-approves its restricted WebSearch and WebFetch tools.</p>' +
        '<div id="blocked-resume-msg"></div>' +
        '<div class="btn-row"><button class="btn" id="blocked-resume-btn">Resume research</button></div></div>');
      right.appendChild(resumeCard);
      var resumeBtn = resumeCard.querySelector("#blocked-resume-btn");
      resumeBtn.addEventListener("click", function () {
        resumeBtn.disabled = true;
        resumeBtn.textContent = "Resuming…";
        var resumeMsg = resumeCard.querySelector("#blocked-resume-msg");
        apiFetch("/api/projects/" + encodeURIComponent(p.id) + "/resume", { method: "POST", body: {} })
          .then(function () { loadAndRenderServerProject(p.id, document.getElementById("server-ws-slot")); })
          .catch(function (e) {
            resumeBtn.disabled = false;
            resumeBtn.textContent = "Resume research";
            resumeMsg.innerHTML = "";
            resumeMsg.appendChild(el('<div class="msg error" role="alert">' + esc(e.message) + '</div>'));
          });
      });
      return;
    }

    var replyCard = el('<div class="card"></div>');
    right.appendChild(replyCard);
    if (!p.sessionId) {
      // No resumable session recorded (rare — e.g. a very early interruption):
      // continuing this exact conversation isn't possible, so say so plainly
      // rather than offering a form that can't work.
      replyCard.innerHTML = '<h3 style="margin-top:0">Add clarification</h3>' +
        '<p class="muted">This project has no previous session recorded, so it can\'t be continued from ' +
        'here. Start a new research project with the missing detail included in your question instead.</p>';
      return;
    }
    replyCard.innerHTML =
      '<h3 style="margin-top:0">Add clarification</h3>' +
      '<p class="hint">Answer what it needs above, in your own words — for example the exact part number, ' +
      'your budget, or whether you already have a datasheet.</p>' +
      '<label class="field sr-only" for="clarify-text">Add clarification</label>' +
      '<textarea id="clarify-text" placeholder="e.g. It\'s a VSC7552-V/5CC, budget is about 40 EUR."></textarea>' +
      '<div id="clarify-msg"></div>' +
      '<div class="btn-row"><button class="btn" id="clarify-btn">Continue research</button></div>';
    var clarifyBtn = replyCard.querySelector("#clarify-btn");
    var clarifyTa = replyCard.querySelector("#clarify-text");
    clarifyBtn.addEventListener("click", function () {
      var msg = replyCard.querySelector("#clarify-msg");
      msg.innerHTML = "";
      var text = clarifyTa.value.trim();
      if (!text) {
        msg.appendChild(el('<div class="msg error" role="alert">Please add a few words before continuing.</div>'));
        clarifyTa.focus();
        return;
      }
      clarifyBtn.disabled = true;
      clarifyBtn.textContent = "Continuing…";
      apiFetch("/api/projects/" + encodeURIComponent(p.id) + "/clarify", { method: "POST", body: { text: text } })
        .then(function () { loadAndRenderServerProject(p.id, document.getElementById("server-ws-slot")); })
        .catch(function (e) {
          clarifyBtn.disabled = false;
          clarifyBtn.textContent = "Continue research";
          msg.appendChild(el('<div class="msg error" role="alert">' + esc(e.message) + '</div>'));
        });
    });
  }

  function renderCompletedState(p, right) {
    var hasWarnings = p.status === "completed-with-warnings";
    var checkFailed = !!(p.citationCheck && p.citationCheck.ok === false);
    var checkUnavailable = !!(p.citationCheck && p.citationCheck.ok == null);
    var researchWarning = !checkFailed && !checkUnavailable && hasWarnings;
    var budgetExhausted = p.stopReason === "budget_exhausted";
    var citeBadge = "";
    if (p.citationCheck && p.citationCheck.ok === true) citeBadge = '<span class="pill complete">Citation check passed</span>';
    else if (checkFailed) citeBadge = '<span class="pill needs-attention">Citation check found issues</span>';
    else if (checkUnavailable) citeBadge = '<span class="pill needs-attention">Citation check unavailable</span>';

    if (hasWarnings) {
      var warnCard = el('<div class="card">' +
        '<h2 style="margin-top:0">Completed — with warnings</h2>' +
        '<p class="muted">' + (checkFailed
          ? 'The report below is real and readable, but an independent, local structural check of its citations found a problem — for example a citation number with no matching source entry.'
          : (checkUnavailable
            ? 'The report below is real and readable, but its citation structure could not be independently checked. This does not mean the citations passed or failed.'
            : esc(p.error || 'The research ended with a material limitation that needs your attention.'))) +
        ' This is not an ordinary clean completion.</p>' +
        (!researchWarning && p.citationCheck && p.citationCheck.detail
          ? '<div class="callout sim"><strong>Checker summary:</strong><br><span style="white-space:pre-wrap">' +
            esc(p.citationCheck.detail) + '</span></div>'
          : '') +
        '<div id="repair-msg"></div>' +
        '<div class="btn-row">' +
        (checkFailed && p.sessionId ? '<button class="btn" id="repair-btn">Ask Claude to fix this</button>' : '') +
        (budgetExhausted && p.sessionId ? '<button class="btn" id="continue-budget-btn">Continue research</button>' : '') +
        helpLinkHtml("reading-the-report", "What does this mean?") + '</div></div>');
      right.appendChild(warnCard);
      if (budgetExhausted) {
        var budgetNote = el('<div class="callout info"><strong>Want a more complete answer?</strong> ' +
          (p.sessionId
            ? 'Continue research keeps this report and all gathered evidence, then runs one additional bounded pass focused on unfinished checks. It uses more of your Claude allowance.'
            : 'This project has no saved Claude session, so it cannot continue the same run. Start a new project if you need more research.') +
          '</div>');
        warnCard.querySelector(".btn-row").before(budgetNote);
      }
      var repairBtn = warnCard.querySelector("#repair-btn");
      if (repairBtn) {
        repairBtn.addEventListener("click", function () {
          repairBtn.disabled = true;
          repairBtn.textContent = "Asking Claude to fix this…";
          var msg = warnCard.querySelector("#repair-msg");
          msg.innerHTML = "";
          apiFetch("/api/projects/" + encodeURIComponent(p.id) + "/repair-citations", { method: "POST", body: {} })
            .then(function () { loadAndRenderServerProject(p.id, document.getElementById("server-ws-slot")); })
            .catch(function (e) {
              repairBtn.disabled = false;
              repairBtn.textContent = "Ask Claude to fix this";
              msg.appendChild(el('<div class="msg error" role="alert">' + esc(e.message) + '</div>'));
            });
        });
      }
      var continueBudgetBtn = warnCard.querySelector("#continue-budget-btn");
      if (continueBudgetBtn) {
        continueBudgetBtn.addEventListener("click", function () {
          continueBudgetBtn.disabled = true;
          continueBudgetBtn.textContent = "Continuing…";
          var msg = warnCard.querySelector("#repair-msg");
          msg.innerHTML = "";
          apiFetch("/api/projects/" + encodeURIComponent(p.id) + "/continue-budget", { method: "POST", body: {} })
            .then(function () { loadAndRenderServerProject(p.id, document.getElementById("server-ws-slot")); })
            .catch(function (e) {
              continueBudgetBtn.disabled = false;
              continueBudgetBtn.textContent = "Continue research";
              msg.appendChild(el('<div class="msg error" role="alert">' + esc(e.message) + '</div>'));
            });
        });
      }
    }

    var card = el('<div class="card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<h2 style="margin:0">Report</h2>' + citeBadge + '</div>' +
      '<p class="small muted">This report was written by the real research run — it is not simulated.</p>' +
      '<div id="toc-slot"></div><div class="doc" id="report-doc"></div></div>');
    right.appendChild(card);
    if (p.reportMarkdown) {
      var docEl = card.querySelector("#report-doc");
      docEl.innerHTML = renderMarkdown(p.reportMarkdown);
      linkifyUrls(docEl);
      buildTocInto(card.querySelector("#toc-slot"), docEl);
    } else {
      card.querySelector("#report-doc").innerHTML = "<p class=\"muted\">No report content was found.</p>";
    }
  }

  function renderFailedState(p, right) {
    var canResume = !!p.sessionId;
    var card = el('<div class="card">' +
      '<h2 style="margin-top:0">Research failed</h2>' +
      '<p class="muted">' + esc(explainError(p.error)) + ' ' + helpLinkHtml("troubleshooting", "Help") + '</p>' +
      (p.error ? '<div class="callout sim"><strong>Details:</strong> ' + esc(p.error) + '</div>' : '') +
      (canResume ? '<p class="hint">Your saved Claude session is still available. You can try continuing ' +
        'after correcting the problem; completed work will be preserved.</p>' +
        '<div id="failed-resume-msg"></div><div class="btn-row">' +
        '<button class="btn" id="failed-resume-btn">Try resuming</button></div>' : '') +
      '</div>');
    right.appendChild(card);
    if (canResume) bindResumeButton(card, p, "#failed-resume-btn", "#failed-resume-msg", "Try resuming");
  }

  function renderInterruptedState(p, right) {
    var canResume = !!p.sessionId;
    var card = el('<div class="card">' +
      '<h2 style="margin-top:0">Interrupted — resumable</h2>' +
      '<p class="muted">' + esc(explainError(p.error)) + ' Resuming continues the same conversation — it ' +
      'does not restart planning or redo completed work. ' + helpLinkHtml("pausing-resuming-and-failures", "Help") + '</p>' +
      (p.error ? '<div class="callout sim"><strong>Details:</strong> ' + esc(p.error) + '</div>' : '') +
      (canResume ? '<div id="resume-msg"></div>' +
        '<div class="btn-row"><button class="btn" id="resume-btn">Resume research</button></div>' :
        '<p class="muted">No previous Claude session was recorded, so this project cannot be resumed.</p>') +
      '</div>');
    right.appendChild(card);
    if (canResume) bindResumeButton(card, p, "#resume-btn", "#resume-msg", "Resume research");
  }

  function bindResumeButton(card, p, buttonSelector, messageSelector, idleLabel) {
    var btn = card.querySelector(buttonSelector);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "Resuming…";
      var msg = card.querySelector(messageSelector);
      apiFetch("/api/projects/" + encodeURIComponent(p.id) + "/resume", { method: "POST", body: {} })
        .then(function () { loadAndRenderServerProject(p.id, document.getElementById("server-ws-slot")); })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = idleLabel;
          msg.innerHTML = "";
          msg.appendChild(el('<div class="msg error" role="alert">' + esc(e.message) + '</div>'));
        });
    });
  }

  // Turns a raw (already-sanitized, non-secret) server error string into a
  // plain-language category the requirements ask for explicitly, while still
  // showing the underlying detail alongside it.
  function explainError(errText) {
    var t = (errText || "").toLowerCase();
    if (!errText) return "Something went wrong and no further detail was recorded.";
    if (/not found on path|not available on this machine/.test(t)) return "Claude Code isn't installed or isn't on your PATH.";
    if (/not signed in|auth/.test(t)) return "Claude Code isn't signed in on this machine.";
    if (/usage limit|session limit|rate limit|quota|too many requests|overloaded|try again later|resets?\s+(?:at\s+)?\d/.test(t)) return "Your Claude usage limit was reached during this run. Wait for the stated reset time, then resume.";
    if (/can(?:not|'t) reach the api server|check your internet or dns|eai_again|enotfound|econnreset|econnrefused|etimedout|network error|network (?:is )?unreachable|temporary failure in name resolution|dns error/.test(t)) return "The connection to Claude was temporarily lost. Check your internet connection, then resume.";
    if (/denied|permission/.test(t)) return "An action was blocked by safety settings.";
    if (/exited with status/.test(t)) return "Claude Code stopped unexpectedly.";
    return "The run did not complete successfully.";
  }

  // ---------------- boot ----------------
  updateSaveWarning(); // show the persistent warning immediately if storage is blocked
  navTo("welcome"); // render immediately; the connectivity check below never blocks first paint
  checkConnected().then(function () {
    // Re-render only if the current screen's content actually depends on
    // connection state (welcome's own text does too, so refresh there too).
    if (state.view === "welcome" || state.view === "projects" || state.view === "new") render();
  });
})();
