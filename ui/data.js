// Example data for the Deep Research prototype UI.
//
// This file contains ONLY fictional, made-up sample content used to demonstrate the
// interface. Nothing here is real research: the sample report's findings and numbers are
// invented, and its "sources" link to placeholder example.com / example.org addresses.
// No real research files are read or embedded.

window.DR_DATA = {
  // Projects shown on the "My research" screen.
  projects: [
    {
      id: "sample-report",
      title: "Which commuter bike suits a 10 km city ride? (sample)",
      question: "I want a low-maintenance bike for a flat 10 km city commute — which type should I get and what should I check before buying?",
      status: "needs-attention",
      statusLabel: "Needs your input",
      updated: "2026-01-01",
      summary: "Fictional sample project used to show the report view — a comparison table, clickable citations, and questions that need your input.",
      report: true,                 // has an embedded (fictional) report to render
      citations: 5,
      progress: 100,
      progressSteps: [
        { state: "done", label: "Understand the commute and constraints", sub: "Complete" },
        { state: "done", label: "Gather bike-type comparisons", sub: "Complete · sample sources" },
        { state: "done", label: "Weigh cost vs. maintenance", sub: "Complete" },
        { state: "active", label: "Waiting on your preferences", sub: "questions in panel" }
      ],
      attention: [
        { title: "What's your budget?", body: "A rough ceiling (including a lock and lights) narrows the options a lot." },
        { title: "Any hills on your route?", body: "Hilly routes tilt the choice toward gears or an e-bike." },
        { title: "Where will you store it?", body: "Tight storage or mixed transit may favour a folding bike." }
      ]
    },
    {
      id: "sample-inprogress",
      title: "Compare budget noise-cancelling headphones (sample)",
      question: "Which noise-cancelling headphones under 150 are best for open-plan office work?",
      status: "in-progress",
      statusLabel: "Researching",
      updated: "2026-01-01",
      summary: "Fictional sample project shown to illustrate what an in-progress project looks like — there is no report yet.",
      report: false,
      progress: 45,
      citations: 0
    }
  ],

  // Suggested follow-up questions, chosen by simple keyword match on the question.
  followups: {
    default: [
      "What decision will this research help you make?",
      "How current does the information need to be?",
      "Roughly how deep should we go — a quick answer or a thorough report?",
      "Are there sources or brands you already trust?"
    ],
    compare: [
      "What's your budget range?",
      "What matters most to you — price, durability, or features?",
      "Any brands or models you already trust, or want to avoid?",
      "When do you need to decide by?"
    ]
  },

  // The editable brief proposed when the question matches the sample question.
  brief: {
    title: "Choosing a commuter bike (sample)",
    question: "I want a low-maintenance bike for a flat 10 km city commute — which type should I get and what should I check before buying?",
    timeframe: "Latest available",
    depth: "Balanced",
    inScope: "Compare common commuter bike types for a flat 10 km ride, weigh cost against maintenance, and list what to check before buying.",
    outScope: "Detailed mechanical repair guides; racing or off-road bikes.",
    tasks: [
      "Clarify the route, distance, and any hills.",
      "Compare the main commuter bike types.",
      "Weigh price against maintenance and running costs.",
      "Summarise a recommendation with what to check before buying."
    ]
  },

  // A fictional sample report, written to exercise the report view (headings, a table,
  // lists, emphasis, a blockquote, and clickable citations). NOT real research.
  reportMarkdown: [
    "# Sample report: choosing a commuter bike for a 10 km city ride",
    "",
    "*This is fictional sample content, generated to demonstrate the prototype's report view. The findings, numbers, and sources below are invented and link to placeholder `example.com` addresses — nothing here is real research.*",
    "",
    "## Answer",
    "",
    "For a flat 10 km city commute, a **single-speed or lightly-geared city bike** is usually the best balance of low maintenance, cost, and comfort [1]. If your route has hills or you value speed, a *lightweight hybrid* with a wider gear range is worth the extra cost [2].",
    "",
    "## How the options compare",
    "",
    "| Bike type | Rough price | Maintenance | Best for |",
    "|---|---|---|---|",
    "| Single-speed city | Low | Very low | Flat routes, low fuss [1] |",
    "| Hybrid | Medium | Medium | Mixed terrain, more speed [2] |",
    "| Folding | Medium–high | Medium | Mixed transit, small storage [3] |",
    "| E-bike | High | Medium–high | Long or hilly commutes, arriving fresh [4] |",
    "",
    "## What to check before buying",
    "",
    "- **Frame size and fit** — the single biggest comfort factor; test-ride if you can [1].",
    "- **Tyre width** — wider tyres roll more comfortably over city surfaces [2].",
    "- **Mounting points** for mudguards and a rack, if you carry things [3].",
    "- **Total cost of ownership**, not just the sticker price: locks, lights, and servicing add up [5].",
    "",
    "> \"The best commuter bike is the one you'll actually ride every day.\" — *illustrative quote, not a real citation*",
    "",
    "## A simple way to decide",
    "",
    "1. Map your route and note any hills or rough surfaces.",
    "2. Set a realistic budget that includes a lock and lights [5].",
    "3. Shortlist two or three types from the table above.",
    "4. Test-ride before committing, and check the fit [1].",
    "",
    "## Open questions for you",
    "",
    "Some choices depend on details only you know — see the panel beside this report.",
    "",
    "## Sources",
    "",
    "[1] Example Cycling Guide — \"Choosing a city bike\" — https://example.com/city-bike-guide — accessed 2026-01-01",
    "[2] Example Reviews — \"Hybrid vs single-speed\" — https://example.com/hybrid-vs-single — accessed 2026-01-01",
    "[3] Example Commuter Blog — \"Folding bikes for transit\" — https://example.org/folding-bikes — accessed 2026-01-01",
    "[4] Example E-bike Roundup — \"E-bikes for commuting\" — https://example.com/ebike-roundup — accessed 2026-01-01",
    "[5] Example Budget Notes — \"The real cost of a bike\" — https://example.org/bike-costs — accessed 2026-01-01"
  ].join("\n")
};
