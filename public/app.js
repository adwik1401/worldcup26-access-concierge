/**
 * Vanilla JS frontend — no framework/build step, so `npm start` + opening
 * a browser is the entire setup. All dynamic text is inserted via
 * textContent (never innerHTML) so nothing the server returns — including
 * an LLM-generated reply — can execute as markup in the page.
 */

const RTL_LANGUAGES = new Set(["ar"]);

const chatLog = document.getElementById("chat-log");
const queryForm = document.getElementById("query-form");
const queryInput = document.getElementById("query-input");
const languageSelect = document.getElementById("language-select");
const sectionSelect = document.getElementById("section-select");
const scenarioButtonsContainer = document.getElementById("scenario-buttons");
const contrastToggle = document.getElementById("contrast-toggle");
const fontIncreaseButton = document.getElementById("font-increase");
const fontDecreaseButton = document.getElementById("font-decrease");
const mapSvg = document.getElementById("venue-map");

// Full venue coordinate data and the current scenario's zone densities,
// cached client-side once loaded so the map can be redrawn (on scenario
// switch, on a new route) without a network round trip each time.
let venueData = null;
let currentZones = {};
// The most recent route drawn on the map, so a scenario switch (which
// redraws the whole map for the new colors) can reapply it afterward
// instead of losing the highlighted route.
let lastRoute = null;

initDisplayPreferences();
loadVenue();
loadScenarios();

languageSelect.addEventListener("change", () => {
  // Scoped to the chat log only — flipping `dir` on <html> would mirror the
  // entire page layout (sidebar, grid columns), not just the conversation.
  chatLog.dir = RTL_LANGUAGES.has(languageSelect.value) ? "rtl" : "ltr";
});

queryForm.addEventListener("submit", handleQuerySubmit);

// ---- Display preferences (high contrast / font size), persisted locally ----

function initDisplayPreferences() {
  const contrastOn = localStorage.getItem("a11y-contrast") === "on";
  const fontScale = Number(localStorage.getItem("a11y-font-scale")) || 1;
  applyContrast(contrastOn);
  applyFontScale(fontScale);

  contrastToggle.addEventListener("click", () => {
    const nowOn = !document.documentElement.classList.contains("high-contrast");
    applyContrast(nowOn);
    localStorage.setItem("a11y-contrast", nowOn ? "on" : "off");
  });

  fontIncreaseButton.addEventListener("click", () => adjustFontScale(0.1));
  fontDecreaseButton.addEventListener("click", () => adjustFontScale(-0.1));
}

function applyContrast(on) {
  document.documentElement.classList.toggle("high-contrast", on);
  contrastToggle.setAttribute("aria-pressed", String(on));
}

function applyFontScale(scale) {
  const clamped = Math.min(1.6, Math.max(0.85, scale));
  document.documentElement.style.setProperty("--font-scale", String(clamped));
  localStorage.setItem("a11y-font-scale", String(clamped));
}

function adjustFontScale(delta) {
  const current = Number(getComputedStyle(document.documentElement).getPropertyValue("--font-scale")) || 1;
  applyFontScale(current + delta);
}

// ---- Venue + scenario data ----

async function loadVenue() {
  try {
    const res = await fetch("/api/venue");
    const data = await res.json();
    venueData = data;

    sectionSelect.innerHTML = "";
    for (const section of data.sections) {
      const option = document.createElement("option");
      option.value = section.id;
      option.textContent = `${section.name} (${section.level})`;
      sectionSelect.appendChild(option);
    }

    renderMap();
  } catch (err) {
    sectionSelect.innerHTML = '<option value="">Could not load sections</option>';
  }
}

async function loadScenarios() {
  try {
    const res = await fetch("/api/scenarios");
    const data = await res.json();
    currentZones = data.zones || {};
    renderScenarioButtons(data.scenarios, data.current);
    renderMap();
  } catch (err) {
    scenarioButtonsContainer.textContent = "Could not load crowd scenarios.";
  }
}

function renderScenarioButtons(scenarios, currentKey) {
  scenarioButtonsContainer.innerHTML = "";
  for (const scenario of scenarios) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = scenario.label;
    button.title = scenario.description;
    button.setAttribute("aria-pressed", String(scenario.key === currentKey));
    button.addEventListener("click", () => switchScenario(scenario.key));
    scenarioButtonsContainer.appendChild(button);
  }
}

async function switchScenario(key) {
  try {
    const res = await fetch("/api/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) return;
    // Re-render from the server's confirmed current key rather than
    // trusting the click alone, so the UI can never drift from server state.
    loadScenarios();
  } catch (err) {
    // Non-fatal for a demo toggle — the previous scenario simply stays active.
  }
}

// ---- Chat ----

function getSelectedAccessibilityNeeds() {
  return Array.from(document.querySelectorAll('input[name="accessibilityNeeds"]:checked')).map((el) => el.value);
}

async function handleQuerySubmit(event) {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;

  appendMessage({ role: "user", text: query });
  queryInput.value = "";
  queryInput.focus();

  const pendingId = appendMessage({ role: "assistant", text: "Thinking…", pending: true });

  try {
    const res = await fetch("/api/concierge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        language: languageSelect.value,
        sectionId: sectionSelect.value || undefined,
        accessibilityNeeds: getSelectedAccessibilityNeeds(),
      }),
    });

    const data = await res.json();
    removeMessage(pendingId);

    if (!res.ok) {
      appendMessage({ role: "assistant", text: data.error || "Something went wrong — please try again." });
      return;
    }

    appendMessage({
      role: "assistant",
      text: data.message,
      source: data.source,
      appliedRules: data.route?.appliedRules,
    });

    if (data.route) {
      lastRoute = { sectionId: sectionSelect.value || undefined, routeResult: data.route };
      renderMap();
    }
  } catch (err) {
    removeMessage(pendingId);
    appendMessage({ role: "assistant", text: "Couldn't reach the concierge — please check your connection and try again." });
  }
}

let messageCounter = 0;

function appendMessage({ role, text, pending, source, appliedRules }) {
  const id = `msg-${++messageCounter}`;
  const wrapper = document.createElement("div");
  wrapper.className = `message message--${role}`;
  wrapper.id = id;

  const bubble = document.createElement("div");
  bubble.className = "message__bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  if (!pending && role === "assistant" && source) {
    const meta = document.createElement("div");
    meta.className = "message__meta";
    meta.textContent = source === "openrouter" ? "Composed live via OpenRouter" : "Offline multilingual mode (no API key configured)";
    wrapper.appendChild(meta);
  }

  if (appliedRules && appliedRules.length > 0) {
    const details = document.createElement("details");
    details.className = "message__rationale";
    const summary = document.createElement("summary");
    summary.textContent = "Why this recommendation";
    details.appendChild(summary);
    const list = document.createElement("ul");
    for (const rule of appliedRules) {
      const item = document.createElement("li");
      item.textContent = rule;
      list.appendChild(item);
    }
    details.appendChild(list);
    wrapper.appendChild(details);
  }

  chatLog.appendChild(wrapper);
  chatLog.scrollTop = chatLog.scrollHeight;
  return id;
}

function removeMessage(id) {
  document.getElementById(id)?.remove();
}

// ---- Venue map ----
//
// A top-down SVG map built from the same x/y grid the routing engine
// scores against — not real cartography, just a visual echo of the data
// already driving the recommendation. Every route drawn here is a
// straight line between two points, the same simplification the engine
// itself uses (see routingEngine.js's Euclidean `distance()`); it is not
// a turn-by-turn walking path. Marked aria-hidden in the HTML because
// every fact it conveys is already in the text reply above it — this is
// a sighted-user convenience layer, not the primary accessible channel.

const SVG_NS = "http://www.w3.org/2000/svg";
const POI_ABBREVIATIONS = { restroom: "R", elevator: "E", medical: "M", quiet_room: "Q", info_desk: "I", concession: "C" };
const MAP_PADDING = 3;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** Hue-only color scale (green -> red) for a 0..1 crowd density value. */
function densityColor(density) {
  const hue = Math.max(0, 140 - 140 * (density ?? 0));
  return `hsl(${hue}, 70%, 45%)`;
}

function computeViewBox(venue) {
  const points = [...venue.gates, ...venue.sections, ...venue.pointsOfInterest];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - MAP_PADDING;
  const minY = Math.min(...ys) - MAP_PADDING;
  const width = Math.max(...xs) - Math.min(...xs) + MAP_PADDING * 2;
  const height = Math.max(...ys) - Math.min(...ys) + MAP_PADDING * 2;
  return `${minX} ${minY} ${width} ${height}`;
}

function drawNodeWithTooltip(shapeEl, tooltipText) {
  const title = svgEl("title");
  title.textContent = tooltipText;
  shapeEl.appendChild(title);
  mapSvg.appendChild(shapeEl);
}

function findSectionByName(name) {
  return venueData.sections.find((s) => s.name === name);
}

/** Mirrors the backend's own fallback in routingEngine.findRoute(): the fan's section if known, else the first gate. */
function resolveOrigin(sectionId) {
  return venueData.sections.find((s) => s.id === sectionId) || venueData.gates[0];
}

function renderRouteOverlay(sectionId, routeResult) {
  if (!routeResult.chosen) return;

  const isSeatRoute = routeResult.intent === "seat";
  const origin = isSeatRoute ? routeResult.chosen : resolveOrigin(sectionId);
  const destination = isSeatRoute ? findSectionByName(routeResult.chosen.targetSection) || routeResult.chosen : routeResult.chosen;
  if (!origin || !destination) return;

  mapSvg.appendChild(svgEl("line", { x1: origin.x, y1: origin.y, x2: destination.x, y2: destination.y, class: "map-route-line" }));
  mapSvg.appendChild(svgEl("circle", { cx: origin.x, cy: origin.y, r: 1, class: "map-origin" }));
  mapSvg.appendChild(svgEl("circle", { cx: destination.x, cy: destination.y, r: 2.2, class: "map-destination-ring" }));
}

function renderMap() {
  if (!venueData) return;

  mapSvg.setAttribute("viewBox", computeViewBox(venueData));
  mapSvg.textContent = ""; // clear previous render — safe (not parsing untrusted markup)

  for (const section of venueData.sections) {
    const dot = svgEl("circle", { cx: section.x, cy: section.y, r: 1, fill: densityColor(currentZones[section.zone]), opacity: 0.5 });
    drawNodeWithTooltip(dot, `${section.name} (${section.level})`);
  }

  for (const gate of venueData.gates) {
    const rect = svgEl("rect", {
      x: gate.x - 0.9,
      y: gate.y - 0.9,
      width: 1.8,
      height: 1.8,
      fill: densityColor(currentZones[gate.zone]),
      stroke: gate.stepFree ? "none" : "#000",
      "stroke-width": gate.stepFree ? 0 : 0.3,
    });
    drawNodeWithTooltip(rect, `${gate.name}${gate.stepFree ? "" : " (not step-free)"}`);

    const label = svgEl("text", { x: gate.x, y: gate.y - 1.3, "text-anchor": "middle", class: "map-label" });
    label.textContent = gate.name.replace("Gate ", "");
    mapSvg.appendChild(label);
  }

  for (const poi of venueData.pointsOfInterest) {
    const circle = svgEl("circle", { cx: poi.x, cy: poi.y, r: 1.1, fill: densityColor(currentZones[poi.zone]), stroke: "#fff", "stroke-width": 0.15 });
    drawNodeWithTooltip(circle, poi.name);

    const label = svgEl("text", { x: poi.x, y: poi.y, "text-anchor": "middle", "dominant-baseline": "central", class: "map-label", fill: "#fff" });
    label.textContent = POI_ABBREVIATIONS[poi.type] || "?";
    mapSvg.appendChild(label);
  }

  if (lastRoute) renderRouteOverlay(lastRoute.sectionId, lastRoute.routeResult);
}
