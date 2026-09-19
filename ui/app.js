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
  var KEYS = { projects: "dr_projects_v1", draft: "dr_draft_v1" };
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
      brief: null,
      edited: {}   // which brief fields the user hand-edited (never auto-overwritten)
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
    saveHealthy: storageOK
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
    var s = esc(text);
    s = s.replace(/`([^`]+)`/g, function (_, c) { return "<code>" + c + "</code>"; });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");     // bold
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");               // italic
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, function (_, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });
    s = s.replace(/\[(\d+)\]/g, function (_, n) {
      return '<a class="cite" href="#src-' + n + '" data-cite="' + n + '">[' + n + "]</a>";
    });
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

  // ---------------- navigation ----------------
  function navTo(view, opts) {
    opts = opts || {};
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
  function viewWelcome() {
    var wrap = el('<section class="screen"></section>');
    wrap.innerHTML =
      '<h1>Research that shows its work</h1>' +
      '<p class="lead">Ask a real-world question in plain language. Deep Research reads sources, ' +
      'keeps track of what is confirmed versus uncertain, and writes you a readable report with ' +
      'clickable citations — so you can trust it and check it.</p>' +

      '<div class="callout sim"><strong>You are viewing a prototype.</strong> This is a design preview only. ' +
      'It does not run research, connect to Claude, or read any documents. The example projects and the sample ' +
      'report are fictional, made-up content used only to show how the interface works.</div>' +

      '<div class="grid">' +
        card("🔎", "Ask in plain language", "No jargon required. Describe what you want to know and what decision it will help you make.") +
        card("⚖️", "Confirmed vs. uncertain", "The report clearly separates what the sources prove from what is still an open question.") +
        card("🔗", "Every claim is cited", "Citations are clickable, so you can jump straight to the source behind any statement.") +
      '</div>' +

      '<div class="card">' +
        '<h2>First time here? Three quick steps</h2>' +
        '<ul class="checklist">' +
          '<li><span class="n">1</span><div><strong>Start with a question.</strong> Go to <em>New research</em> and type what you want to know — a sentence or two is enough.</div></li>' +
          '<li><span class="n">2</span><div><strong>Answer a few follow-ups.</strong> We suggest short questions to sharpen the request. Skipping them is fine.</div></li>' +
          '<li><span class="n">3</span><div><strong>Review and edit the brief.</strong> You approve a plain-language plan before anything would start. In this prototype, approving opens a simulated workspace.</div></li>' +
        '</ul>' +
        '<div class="btn-row">' +
          '<button class="btn" id="w-start">Start a new research project</button>' +
          '<button class="btn secondary" id="w-examples">See example projects</button>' +
        '</div>' +
      '</div>' +

      '<p class="small muted">No account or setup is needed to explore this prototype. How a finished app would run ' +
      'research — including any Claude integration, installation, or billing — is not decided yet and is out of scope here.</p>';

    wrap.querySelector("#w-start").addEventListener("click", function () { navTo("new"); });
    wrap.querySelector("#w-examples").addEventListener("click", function () { navTo("projects"); });
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
    wrap.appendChild(el(storageNote()));

    var mine = state.projects || [];
    var examples = DATA.projects || [];

    if (!mine.length && !examples.length) {
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

    wrap.appendChild(el('<h2 class="section-title">Example projects</h2>'));
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
    else wrap.appendChild(stepBrief());
    return wrap;
  }

  function stepper(step) {
    function s(n, label) {
      var cls = "step" + (n === step ? " active" : "") + (n < step ? " done" : "");
      var num = n < step ? "✓" : n;
      return '<div class="' + cls + '"><span class="num">' + num + '</span>' + label + '</div>';
    }
    return el('<div class="stepper" role="list">' + s(1, "Your question") + s(2, "Follow-ups") + s(3, "Review brief") + '</div>');
  }

  function stepQuestion() {
    var d = state.draft;
    var c = el('<div class="card"></div>');
    c.innerHTML =
      '<label class="field" for="q">What do you want to find out?</label>' +
      '<p class="hint" id="q-hint">Write it the way you would ask a knowledgeable colleague. One or two sentences is plenty.</p>' +
      '<textarea id="q" aria-describedby="q-hint" placeholder="e.g. I want a low-maintenance bike for a flat 10 km city commute — which type should I get and what should I check before buying?"></textarea>' +
      '<div id="q-err"></div>' +

      '<label class="field" for="file">Add documents (optional)</label>' +
      '<p class="hint">Datasheets, notes, PDFs — anything that helps.</p>' +
      '<div class="callout sim"><strong>Prototype note:</strong> selected files are recorded by name only and carried into the brief as context. ' +
      'They are <strong>not uploaded, opened, or read</strong> — document processing is not part of this preview.</div>' +
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
        '<button class="btn" id="fu-next">Build my research brief</button>' +
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
    c.querySelector("#fu-next").addEventListener("click", function () { d.step = 3; syncBrief(d); persistDraft(); navTo("new"); });
    return c;
  }

  // Auto-derive the brief from current setup (question, depth, timeframe).
  function deriveBrief(d) {
    var base = DATA.brief || {};
    var q = (d.question || "").trim();
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
    syncBrief(d); // keep non-edited fields in step with any setup changes
    var b = d.brief;

    var c = el('<div class="card"></div>');
    c.innerHTML =
      '<h2 style="margin-top:0">Your research brief</h2>' +
      '<p class="muted">This is the plan the app would follow. Edit anything below, then approve it. ' +
      'You stay in control — nothing starts until you say so.</p>' +
      '<div class="callout info">Editing here is fully functional. Approving the brief saves the project in this browser and ' +
      'opens a <strong>simulated</strong> workspace — no real research is started.</div>' +

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

    c.querySelector("#b-back").addEventListener("click", function () { d.step = 2; persistDraft(); navTo("new"); });
    c.querySelector("#b-approve").addEventListener("click", function () {
      var msg = c.querySelector("#b-msg"); msg.innerHTML = "";
      if (!b.title.trim() || !b.question.trim()) {
        msg.appendChild(el('<div class="msg error" role="alert">A title and a question are needed before approving the brief.</div>'));
        return;
      }
      b.tasks = b.tasks.filter(function (t) { return t.trim() !== ""; });

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
    if (!project) {
      var e = el('<section class="screen"></section>');
      e.appendChild(el('<div class="empty"><div class="icon">🤔</div><p><strong>That project could not be found.</strong></p>' +
        '<p>It may have been deleted or was a temporary preview.</p></div>'));
      var back = el('<div class="btn-row"><button class="btn secondary">Back to My research</button></div>');
      back.querySelector("button").addEventListener("click", function () { navTo("projects"); });
      e.appendChild(back);
      return e;
    }
    if (project.report) return workspaceExampleReport(project);
    return workspaceSimulated(project);
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
      '<p><strong>Depth:</strong> ' + esc(ctx.depth || p.depth || "") + ' &nbsp;·&nbsp; <strong>How current:</strong> ' + esc(ctx.timeframe || p.timeframe || "") + '</p>' +
      '<p><strong>In scope:</strong> ' + esc(p.inScope || "") + '</p>' +
      '<p><strong>Out of scope:</strong> ' + esc(p.outScope || "") + '</p>';
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

  // ---------------- boot ----------------
  updateSaveWarning(); // show the persistent warning immediately if storage is blocked
  navTo("welcome");
})();
