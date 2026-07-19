# Liberty Field Access Concierge

A GenAI accessibility & navigation concierge for fans at the FIFA World Cup 2026 — built for
**Promptwars Challenge 4**.

**Live demo:** https://worldcup26-access-concierge.netlify.app — deployed intentionally without a
live `OPENROUTER_API_KEY`, so it runs in the offline multilingual fallback mode described below
(no spendable API credential exposed on a public URL). Every feature is fully demonstrable this
way; see [How the solution works](#how-the-solution-works) to run it locally with live GenAI
responses instead.

## Chosen vertical

**Fan Accessibility & Navigation Concierge.** The persona is a fan — specifically one with an
accessibility need (mobility, visual, hearing, or sensory) and/or a non-English speaker — who
needs fast, dependable, in-the-moment answers inside the venue: *where's the nearest accessible
restroom, how do I get to my seat, is there somewhere quiet I can go, where can I get food.*

Why this focus, not the other seven domains in the brief: FIFA has already committed, for 2026, to
dedicated mobility-assistance staff at every venue and first-ever sign-language interpretation for
every match — genuinely good, official accessibility investments. But a fan still hits moments
those services aren't immediately at hand: staff are busy elsewhere, the fan doesn't speak the
staff's language, or it's 2am and they just need an answer fast. A 75,000-seat stadium is
typically reported to have only around 200 wheelchair-accessible seats (~0.26% of capacity) —
fans holding those scarce accessible tickets have far less slack if something goes wrong mid-event.
This concierge is the self-service, always-on layer for that gap. **It complements FIFA's official
accessibility commitments — it does not replace human escorts or sign-language interpretation.**

**A narrow persona, not a narrow build.** The vertical is deliberately one persona, but the product
itself genuinely touches five of the brief's eight named domains, not just one:

| Domain (from the brief) | Where it shows up |
|---|---|
| Navigation | The routing engine + stadium-bowl map are the core of the product |
| Accessibility | The primary lens the whole tool is built through |
| Multilingual assistance | 5 languages, fully offline-capable, not a bolted-on translation layer |
| Crowd management | Live crowd-density scenarios directly drive routing decisions and are visualized on the map |
| Real-time decision support | The "why this recommendation" panel + the deterministic-engine-then-GenAI-phrasing architecture *is* a real-time decision-support pattern — applied to a fan-facing case, not an operator dashboard |

Transportation, sustainability, and operational intelligence are genuinely out of scope — that's the
deliberate choice explained above, not an oversight.

### Meeting the challenge's own expectations

The brief asks for four specific things. Concretely, not just as a pitch:

| Expectation (brief's own words) | How this build meets it |
|---|---|
| "Ability to build a smart, dynamic assistant" | The concierge re-plans live: switch a crowd scenario and re-ask the same question — [`server/engine/routingEngine.js`](server/engine/routingEngine.js)'s `findRoute()` recomputes the recommendation from current density data, and the stadium-bowl map redraws to match, in the fan's own language |
| "Logical decision making based on user context" | [`meetsAccessibilityNeeds()`](server/engine/routingEngine.js), `scorePOI()`, and `findGateForSection()` filter and rank purely on the fan's stated profile (mobility/sensory needs) and live crowd data — and every decision ships with a visible, plain-language rationale (the "Why this recommendation" panel), not a black box |
| "Practical and real-world usability" | Fully functional with zero setup cost (no API key required — see the offline fallback below), accessible by design (keyboard nav, ARIA, high-contrast mode, adjustable text size), and grounded in a real, cited accessibility gap (FIFA's own 2026 commitments, see below) rather than a hypothetical one |
| "Clean and maintainable code" | 21 automated tests, ESLint with zero findings, and full static type-checking via JSDoc + `tsconfig.json`'s `checkJs` (`npm run typecheck`) — real type safety with no build step, no framework, and a strict separation between the deterministic decision layer and the GenAI phrasing layer |

## Approach and logic

The core design decision is a **two-layer architecture**, so the actual routing *decision* is
deterministic and testable, and the LLM's only job is composing natural language on top of it:

1. **Deterministic routing engine** (`server/engine/routingEngine.js`) — pure functions, no LLM,
   no I/O. Given a fan's profile (accessibility needs, seat section) and a free-text query, it:
   - detects intent via keyword matching (restroom / elevator / medical / quiet room / seat /
     concession / info desk),
   - filters out any point of interest that doesn't meet the stated accessibility need (e.g. a
     stairs-only restroom is excluded outright for a wheelchair profile, not just deprioritized),
   - scores the remaining candidates by distance *and* live crowd density, weighting the crowd
     penalty more heavily for mobility/sensory profiles (moving through a packed concourse costs
     more for those fans),
   - and returns a structured result: the chosen recommendation, up to two alternatives, and a
     list of **applied rules** — the actual reasons behind the decision (e.g. *"Gate D is closest
     to your section, but isn't step-free — routed to Gate A instead"*).

   This is the "logical decision making based on user context" the challenge asks for, and it's
   why the engine is unit-tested independently of any GenAI call — a safety-relevant routing
   decision shouldn't depend on a model call succeeding.

2. **GenAI composition layer** (`server/engine/llmClient.js`) — takes that structured result plus
   the fan's original question and *language*, and asks an LLM (via **OpenRouter**) to phrase it
   as a warm, concise reply in the fan's own language, grounded strictly in the JSON it's given
   (the prompt explicitly forbids inventing facilities or data). OpenRouter is called with the
   platform's built-in `fetch` — no vendor SDK — so the model is swappable via an env var with no
   code change.

   **If no `OPENROUTER_API_KEY` is configured, the app doesn't degrade to an error — it falls back
   to a fully offline, deterministic multilingual composer** (`server/engine/i18n.js`) that builds
   the same reply directly from the structured data, in English, Spanish, French, Portuguese, or
   Arabic. The offline layer isn't a stub; it's what every automated test in this repo exercises,
   so the whole app is provably functional without any API key.

A demo-only "simulate crowd conditions" toggle in the UI stands in for a live density feed — switch
it and watch the concierge's recommendation (and its high-density warning) change in real time.

## How the solution works

**Requirements:** Node.js ≥ 20.10 (developed and tested on Node 24).

```bash
npm install
cp .env.example .env   # optional — the app runs fully without this
npm start
```

Then open `http://localhost:3000`. To run the automated tests (zero network, zero API key
required), the linter, and the type checker:

```bash
npm test
npm run lint
npm run typecheck
```

**To enable live GenAI responses** instead of the offline fallback, get a free key at
[openrouter.ai/keys](https://openrouter.ai/keys) and set `OPENROUTER_API_KEY` in `.env`.
`OPENROUTER_MODEL` is configurable (defaults to a fast, inexpensive Claude Haiku-class model on
OpenRouter).

### Feature walkthrough

- Pick a language, your seat section, and any accessibility needs in the left panel.
- Ask a question in plain language — try *"where is the nearest restroom"*, *"find my seat"*,
  *"is there a quiet room"*, or *"where can I get food"*.
- Every reply includes an expandable **"Why this recommendation"** panel showing the actual rules
  the engine applied — this is deliberately not hidden, both as a transparency/accessibility
  feature and as the clearest evidence of context-aware decision making.
- Toggle **high contrast** and text size (**A− / A+**) in the header — persisted across visits.
- Switch **crowd scenarios** in the left panel and re-ask the same question to see the
  recommendation change.
- A **live stadium-bowl map** sits above the chat: a pitch at the center with each stand (North /
  East / South / West) drawn as a wedge that tints from clear to busy by its current crowd density
  — the fastest way to read the venue at a glance — plus every gate and point of interest as a
  small hand-drawn icon, and your last route drawn as a dashed arrow from a "you are here" pin to a
  pulsing destination ring. It's a direct visualization of the same coordinate data and crowd state
  the routing engine scores against — not a separate system, so it can never show something the
  text reply doesn't already say. See *Why not AR / live camera navigation* below for why this is a
  2D map rather than a camera view.

### Why not AR / live camera navigation

This was considered and deliberately scoped out. Liberty Field is a **fictional** venue — there is
no real physical space to point a camera at, so true computer vision (detecting real doorways,
signage, obstacles) has nothing to ground itself in. The two ways to still make "AR" honest here
both have real costs: marker-based AR would need printed markers taped up in a real room (friction
for anyone testing this, including judges), and a compass-style camera overlay (device heading +
a known start point, no scene understanding) only works meaningfully on a phone — most desktop
browsers have no magnetometer, and this submission is meant to be reviewable via `npm start` on a
laptop. The 2D map delivers the actual ask — *live, visual, direction instead of just chat* — on
any device, with no camera/motion permissions, and it's honest about what it is: a straight-line
indicator between two points, not a turn-by-turn walking path (the same simplification the routing
engine's own distance scoring already makes).

### Architecture at a glance

```
server/
  app.js              Express app assembly (no listener — importable by tests)
  index.js            entry point: creates the app, starts listening
  routes/
    concierge.js       POST /api/concierge — validates input, runs the engine, composes a reply
    venue.js            GET /api/venue, GET/POST /api/scenario(s)
  engine/
    routingEngine.js    deterministic routing/decision logic (pure functions)
    llmClient.js         OpenRouter call + graceful fallback to the offline composer
    i18n.js               offline multilingual reply composer (en/es/fr/pt/ar)
    crowdState.js          in-memory "current crowd scenario" state (demo toggle)
  data/
    venue.json           fictional venue: gates, sections, accessibility-tagged points of interest
    crowdScenarios.json    three named crowd-density scenarios
public/                 vanilla HTML/CSS/JS frontend — no framework, no build step
tests/                  node:test suite (21 tests) for the engine and the API routes
netlify/functions/api.js  wraps the same server/app.js via serverless-http for the live deploy
netlify.toml             redirects /api/* to the function; publishes public/ as static
types.d.ts               shared ambient JSDoc types (Venue, RouteResult, etc.) for `npm run typecheck`
tsconfig.json            checkJs config — static type-checking with zero build step
eslint.config.js         lint config — `npm run lint`
```

**Deployment:** the live demo runs on Netlify — `netlify.toml` publishes `public/` as a static site
and redirects `/api/*` to a single Netlify Function (`netlify/functions/api.js`) that wraps the
exact same Express app `npm start` runs locally via `serverless-http`, so there's one source of
truth for routes/validation, not a parallel implementation. One known tradeoff of serverless
hosting: the crowd-scenario demo toggle (`crowdState.js`) is in-memory, which `npm start`
guarantees persists (one long-lived process) but Netlify's serverless runtime only reliably shares
across requests hitting the same warm function instance — fine for a demo session, not a real
production guarantee.

## Assumptions

- **The venue is fictional** ("Liberty Field") — an illustrative composite, not a schematic of any
  real FIFA World Cup 2026 stadium. Distances are described qualitatively ("very close by") rather
  than in a fabricated unit, since the coordinate grid isn't calibrated to a real floor plan.
- **Crowd data is simulated**, toggled via a demo control, not ingested from live sensors.
- This tool is explicitly a **complement to FIFA's official 2026 accessibility commitments**
  (mobility-escort staff, all-match sign-language interpretation) — not a replacement for them.
- **Plain Node.js + Express + vanilla frontend**, chosen over a framework/build-step stack (e.g.
  React) to minimize dependency surface and setup friction, and to keep the repository small and
  auditable — a deliberate simplicity trade-off given the competition's size and time constraints.
- **The app is fully functional with zero API key** (offline multilingual fallback); an
  `OPENROUTER_API_KEY` only upgrades response naturalness, it doesn't unlock functionality.
- Language set (English, Spanish, French, Portuguese, Arabic) was chosen to reflect the three 2026
  host nations (USA, Mexico, Canada) plus broad additional reach, not to be exhaustive.
- **Future work, out of scope for this submission:** live-camera-based obstacle detection for
  low-vision/wheelchair users (inspired by hackathon projects like "Sightmate") was considered but
  excluded — a camera/video pipeline is disproportionate complexity for this submission's size and
  time budget.
- **Typography loads from Google Fonts over CDN** (Space Grotesk, Plus Jakarta Sans, JetBrains
  Mono) — the one external network request the frontend makes besides the API itself. It's a
  `<link>` tag, not an npm dependency, so it doesn't affect repo size or the no-build-step setup;
  if it fails to load (e.g. offline), the browser falls back to the specified system font stack and
  the app remains fully usable. All icons are hand-authored inline SVG — no icon library
  dependency.

## Originality

Built from scratch for this challenge. No code was forked, cloned, or scaffolded from any existing
repository.

## License

MIT — see [LICENSE](LICENSE).
