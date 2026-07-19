/**
 * Vanilla JS frontend — no framework/build step, so `npm start` + opening
 * a browser is the entire setup. All dynamic text is inserted via
 * textContent (never innerHTML) so nothing the server returns — including
 * an LLM-generated reply — can execute as markup in the page.
 */

const RTL_LANGUAGES = new Set(["ar"]);

/**
 * Looks up a required DOM element by id, throwing immediately with a clear
 * message if it's missing — fails loudly at page load if index.html and
 * this script ever drift out of sync, instead of a cryptic "cannot read
 * property of null" deep inside some later interaction handler. Also the
 * single place that resolves TypeScript's `Element | null` return type from
 * `getElementById`, rather than scattering null-checks/assertions below.
 * @param {string} id
 * @returns {HTMLElement}
 */
function requireEl(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Expected #${id} to exist in the page`);
  return el;
}

const chatLog = requireEl("chat-log");
const queryForm = requireEl("query-form");
const queryInput = /** @type {HTMLInputElement} */ (requireEl("query-input"));
const languageSelect = /** @type {HTMLSelectElement} */ (requireEl("language-select"));
const sectionSelect = /** @type {HTMLSelectElement} */ (requireEl("section-select"));
const scenarioButtonsContainer = requireEl("scenario-buttons");
const contrastToggle = requireEl("contrast-toggle");
const fontIncreaseButton = requireEl("font-increase");
const fontDecreaseButton = requireEl("font-decrease");
// requireEl() returns HTMLElement — an <svg> is an SVGElement, a sibling
// type with insufficient overlap for a direct cast, hence the `unknown`
// step-through (this is the one non-HTML element requireEl() looks up).
const mapSvg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (requireEl("venue-map")));

// Full venue coordinate data and the current scenario's zone densities,
// cached client-side once loaded so the map can be redrawn (on scenario
// switch, on a new route) without a network round trip each time.
/** @type {Venue | null} */
let venueData = null;
/** @type {CrowdZones} */
let currentZones = {};
// The most recent route drawn on the map, so a scenario switch (which
// redraws the whole map for the new colors) can reapply it afterward
// instead of losing the highlighted route.
/** @type {{ sectionId: string | undefined, routeResult: RouteResult } | null} */
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

/** @param {boolean} on */
function applyContrast(on) {
  document.documentElement.classList.toggle("high-contrast", on);
  contrastToggle.setAttribute("aria-pressed", String(on));
}

/** @param {number} scale */
function applyFontScale(scale) {
  const clamped = Math.min(1.6, Math.max(0.85, scale));
  document.documentElement.style.setProperty("--font-scale", String(clamped));
  localStorage.setItem("a11y-font-scale", String(clamped));
}

/** @param {number} delta */
function adjustFontScale(delta) {
  const current = Number(getComputedStyle(document.documentElement).getPropertyValue("--font-scale")) || 1;
  applyFontScale(current + delta);
}

// ---- Venue + scenario data ----

async function loadVenue() {
  try {
    const res = await fetch("/api/venue");
    const data = /** @type {Venue} */ (await res.json());
    venueData = data;

    sectionSelect.innerHTML = "";
    for (const section of data.sections) {
      const option = document.createElement("option");
      option.value = section.id;
      option.textContent = `${section.name} (${section.level})`;
      sectionSelect.appendChild(option);
    }

    renderMap();
    renderMapLegend();
  } catch {
    sectionSelect.innerHTML = '<option value="">Could not load sections</option>';
  }
}

async function loadScenarios() {
  try {
    const res = await fetch("/api/scenarios");
    /** @type {{ current: string, zones: CrowdZones, scenarios: Array<{ key: string, label: string, description: string }> }} */
    const data = await res.json();
    currentZones = data.zones || {};
    renderScenarioButtons(data.scenarios, data.current);
    renderMap();
  } catch {
    scenarioButtonsContainer.textContent = "Could not load crowd scenarios.";
  }
}

/**
 * @param {Array<{ key: string, label: string, description: string }>} scenarios
 * @param {string} currentKey
 */
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

/** @param {string} key */
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
  } catch {
    // Non-fatal for a demo toggle — the previous scenario simply stays active.
  }
}

// ---- Chat ----

/** @returns {string[]} */
function getSelectedAccessibilityNeeds() {
  const checked = /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll('input[name="accessibilityNeeds"]:checked')
  );
  return Array.from(checked).map((el) => el.value);
}

/** @param {SubmitEvent} event */
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

    /** @type {ConciergeReply & { route?: RouteResult, error?: string }} */
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
  } catch {
    removeMessage(pendingId);
    appendMessage({ role: "assistant", text: "Couldn't reach the concierge — please check your connection and try again." });
  }
}

let messageCounter = 0;

/**
 * @param {AppendMessageArgs} args
 * @returns {string} the new message element's id, for later removal (see removeMessage)
 */
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

/** @param {string} id */
function removeMessage(id) {
  document.getElementById(id)?.remove();
}

// ---- Venue map ----
//
// A stadium-bowl SVG map — field in the middle, section wedges arranged
// radially around it, gates and points of interest on the outer
// concourse — built from the same x/y coordinates the routing engine
// scores against (see venue.json's polar layout). Every route drawn
// here is a straight line between two points, the same simplification
// the engine itself uses (routingEngine.js's Euclidean `distance()`);
// it is not a turn-by-turn walking path. Marked aria-hidden in the HTML
// because every fact it conveys is already in the text reply above it —
// this is a sighted-user convenience layer, not the primary accessible
// channel.
//
// Section wedge shapes come from angleStart/angleEnd/ring fields in
// venue.json — rendering hints only. routingEngine.js never reads them;
// it only ever uses x/y/zone, so this map layer can't influence routing.

const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_PADDING = 4;
const FIELD_RX = 8;
const FIELD_RY = 5;
/** @type {Record<"lower" | "upper", { inner: EllipseRadius, outer: EllipseRadius }>} */
const RING_RADII = {
  lower: { inner: { rx: 9, ry: 5.6 }, outer: { rx: 12.5, ry: 7.8 } },
  upper: { inner: { rx: 12.5, ry: 7.8 }, outer: { rx: 15.5, ry: 9.7 } },
};
// Each zone's compass side and the angle (degrees) its gate sits at on the
// bowl — declared directly rather than reverse-engineered from gate
// coordinates, since this *is* the design (see venue.json's layoutNote).
const ZONE_SIDES = {
  "zone-a": { label: "North", angle: 270 },
  "zone-b": { label: "East", angle: 0 },
  "zone-c": { label: "South", angle: 90 },
  "zone-d": { label: "West", angle: 180 },
};

// Hand-authored, single-stroke-width icon glyphs (24x24 viewBox) — no icon
// library dependency, kept visually consistent with the icons used
// elsewhere in index.html.
/** @type {IconPartsMap} */
const MARKER_ICON_PARTS = {
  restroom: [
    ["circle", { cx: 12, cy: 6, r: 2.3 }],
    ["path", { d: "M8.3 20 9.7 11.5h4.6L15.7 20M9.3 12.5V8.2h5.4v4.3" }],
  ],
  elevator: [["path", { d: "M8 9.5 12 5.5 16 9.5M8 14.5 12 18.5 16 14.5" }]],
  medical: [["path", { d: "M12 5v14M5 12h14" }]],
  quiet_room: [["path", { d: "M19.5 14.8A8 8 0 1 1 9.2 4.5a6.5 6.5 0 0 0 10.3 10.3Z" }]],
  info_desk: [
    ["circle", { cx: 12, cy: 12, r: 8.5 }],
    ["path", { d: "M12 11v5.5" }],
  ],
  concession: [
    ["path", { d: "M7 8h10l-1.3 10.2A2 2 0 0 1 13.7 20h-3.4a2 2 0 0 1-2-1.8L7 8Z" }],
    ["path", { d: "M9.3 5h5.4l.5 3H8.8l.5-3Z" }],
  ],
  gate: [["rect", { x: 6.5, y: 3.5, width: 11, height: 17, rx: 1 }]],
};

/** @type {Array<[PoiType | "gate", string]>} */
const LEGEND_ITEMS = [
  ["gate", "Gate"],
  ["restroom", "Restroom"],
  ["elevator", "Elevator"],
  ["medical", "Medical"],
  ["quiet_room", "Quiet room"],
  ["info_desk", "Info desk"],
  ["concession", "Concession"],
];

/**
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/**
 * Hue-only color scale (calm green -> amber -> red) for a 0..1 crowd density value.
 * @param {number | undefined} density
 * @returns {string}
 */
function densityColor(density) {
  const hue = Math.max(0, 130 - 130 * (density ?? 0));
  return `hsl(${hue}, 62%, 42%)`;
}

/**
 * The white icon-outline <g> for a marker type — shared by both the map markers and the legend swatches.
 * @param {PoiType | "gate"} type
 * @returns {SVGElement}
 */
function buildIconGroup(type) {
  const group = svgEl("g", { fill: "none", stroke: "#fff", "stroke-width": 2.1, "stroke-linecap": "round", "stroke-linejoin": "round" });
  for (const [tag, attrs] of MARKER_ICON_PARTS[type] || []) group.appendChild(svgEl(tag, attrs));
  return group;
}

/**
 * A small nested <svg> (own 24x24 viewBox) so icon geometry never has to fight the map's grid coordinate space.
 * @param {PoiType | "gate"} type
 * @param {number} cx
 * @param {number} cy
 * @param {number} size
 * @returns {SVGElement}
 */
function buildMarkerIcon(type, cx, cy, size) {
  const nested = svgEl("svg", { x: cx - size / 2, y: cy - size / 2, width: size, height: size, viewBox: "0 0 24 24" });
  nested.appendChild(buildIconGroup(type));
  return nested;
}

/**
 * @param {Venue} venue
 * @returns {string} an SVG viewBox attribute value
 */
function computeViewBox(venue) {
  // Gates sit on the outermost ring in this layout, so gate/section/POI
  // point extents already bound the whole bowl (field + wedges nest
  // entirely inside the gate ring) — no separate field/wedge geometry
  // needs to factor into this.
  const points = [...venue.gates, ...venue.sections, ...venue.pointsOfInterest];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - MAP_PADDING;
  const minY = Math.min(...ys) - MAP_PADDING;
  const width = Math.max(...xs) - Math.min(...xs) + MAP_PADDING * 2;
  const height = Math.max(...ys) - Math.min(...ys) + MAP_PADDING * 2;
  return `${minX} ${minY} ${width} ${height}`;
}

/**
 * A point on an ellipse at the given angle (degrees; 0=East, 90=South, 180=West, 270=North — matches on-screen compass directions since SVG y grows downward).
 * @param {number} angleDeg
 * @param {number} rx
 * @param {number} ry
 * @returns {{ x: number, y: number }}
 */
function polarPoint(angleDeg, rx, ry) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: rx * Math.cos(rad), y: ry * Math.sin(rad) };
}

/**
 * SVG path for a donut-segment "stand" wedge between two concentric ellipses, from angleStart to angleEnd.
 * @param {EllipseRadius} inner
 * @param {EllipseRadius} outer
 * @param {number} angleStart
 * @param {number} angleEnd
 * @returns {string}
 */
function wedgePath(inner, outer, angleStart, angleEnd) {
  const largeArc = Math.abs(angleEnd - angleStart) > 180 ? 1 : 0;
  const p1 = polarPoint(angleStart, outer.rx, outer.ry);
  const p2 = polarPoint(angleEnd, outer.rx, outer.ry);
  const p3 = polarPoint(angleEnd, inner.rx, inner.ry);
  const p4 = polarPoint(angleStart, inner.rx, inner.ry);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${outer.rx} ${outer.ry} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${inner.rx} ${inner.ry} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

/**
 * @param {SVGElement} shapeEl
 * @param {string} tooltipText
 */
function drawNodeWithTooltip(shapeEl, tooltipText) {
  const title = svgEl("title");
  title.textContent = tooltipText;
  shapeEl.appendChild(title);
  mapSvg.appendChild(shapeEl);
}

function ensureRouteArrowDef() {
  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "route-arrowhead",
    viewBox: "0 0 10 10",
    refX: 7,
    refY: 5,
    markerWidth: 3,
    markerHeight: 3,
    orient: "auto-start-reverse",
  });
  marker.appendChild(svgEl("path", { d: "M0 0 L10 5 L0 10 Z", class: "map-route-arrowhead" }));
  defs.appendChild(marker);
  mapSvg.appendChild(defs);
}

/**
 * @param {Venue} venue
 * @param {string | undefined} name
 * @returns {VenueSection | undefined}
 */
function findSectionByName(venue, name) {
  return venue.sections.find((s) => s.name === name);
}

/**
 * Mirrors the backend's own fallback in routingEngine.findRoute(): the fan's section if known, else the first gate.
 * @param {Venue} venue
 * @param {string | undefined} sectionId
 * @returns {VenueSection | Gate}
 */
function resolveOrigin(venue, sectionId) {
  return venue.sections.find((s) => s.id === sectionId) || venue.gates[0];
}

/**
 * "You are here" marker — a map-pin silhouette, tip anchored at (x, y), rather than a plain dot.
 * @param {number} x
 * @param {number} y
 */
function renderOriginPin(x, y) {
  const size = 2.2;
  const pin = svgEl("svg", { x: x - size / 2, y: y - size, width: size, height: size, viewBox: "0 0 24 24" });
  pin.appendChild(svgEl("path", { d: "M12 22s7-7.58 7-13a7 7 0 1 0-14 0c0 5.42 7 13 7 13Z", class: "map-origin-pin" }));
  pin.appendChild(svgEl("circle", { cx: 12, cy: 9, r: 2.6, fill: "#fff" }));
  mapSvg.appendChild(pin);
}

/**
 * @param {Venue} venue
 * @param {string | undefined} sectionId
 * @param {RouteResult} routeResult
 */
function renderRouteOverlay(venue, sectionId, routeResult) {
  if (!routeResult.chosen) return;

  const isSeatRoute = routeResult.intent === "seat";
  const origin = isSeatRoute ? routeResult.chosen : resolveOrigin(venue, sectionId);
  const destination = isSeatRoute ? findSectionByName(venue, routeResult.chosen.targetSection) || routeResult.chosen : routeResult.chosen;
  if (!origin || !destination) return;

  mapSvg.appendChild(
    svgEl("line", {
      x1: origin.x,
      y1: origin.y,
      x2: destination.x,
      y2: destination.y,
      class: "map-route-line",
      "marker-end": "url(#route-arrowhead)",
    })
  );

  renderOriginPin(origin.x, origin.y);
  mapSvg.appendChild(svgEl("circle", { cx: destination.x, cy: destination.y, r: 1.5, class: "map-destination-ring" }));
}

function renderMap() {
  if (!venueData) return;

  mapSvg.setAttribute("viewBox", computeViewBox(venueData));
  mapSvg.textContent = ""; // clear previous render — safe (not parsing untrusted markup)
  ensureRouteArrowDef();

  mapSvg.appendChild(svgEl("ellipse", { cx: 0, cy: 0, rx: FIELD_RX, ry: FIELD_RY, class: "map-field" }));
  mapSvg.appendChild(svgEl("ellipse", { cx: 0, cy: 0, rx: FIELD_RX, ry: FIELD_RY, class: "map-field-line" }));
  mapSvg.appendChild(svgEl("line", { x1: 0, y1: -FIELD_RY, x2: 0, y2: FIELD_RY, class: "map-field-line" }));

  for (const section of venueData.sections) {
    const ring = RING_RADII[section.ring];
    const wedge = svgEl("path", {
      d: wedgePath(ring.inner, ring.outer, section.angleStart, section.angleEnd),
      class: "map-node",
      fill: densityColor(currentZones[section.zone]),
      stroke: "var(--color-surface)",
      "stroke-width": 0.12,
    });
    drawNodeWithTooltip(wedge, `${section.name} (${section.level}) — ${Math.round((currentZones[section.zone] ?? 0) * 100)}% capacity`);

    const midAngle = (section.angleStart + section.angleEnd) / 2;
    const midRadius = { rx: (ring.inner.rx + ring.outer.rx) / 2, ry: (ring.inner.ry + ring.outer.ry) / 2 };
    const labelPos = polarPoint(midAngle, midRadius.rx, midRadius.ry);
    const label = svgEl("text", { x: labelPos.x, y: labelPos.y, "text-anchor": "middle", "dominant-baseline": "central", class: "map-label map-label--on-wedge" });
    label.textContent = section.name.replace("Section ", "");
    mapSvg.appendChild(label);
  }

  for (const { label: sideLabel, angle } of Object.values(ZONE_SIDES)) {
    // Placed on the pitch itself (well inside the field ellipse), not
    // between the field and the stands — the single-wedge East/West
    // sides have no room out there without colliding with the section
    // number label, since they (unlike North/South) have no second,
    // farther-out upper-tier wedge to push that label further away.
    const pos = polarPoint(angle, FIELD_RX * 0.55, FIELD_RY * 0.55);
    const label = svgEl("text", { x: pos.x, y: pos.y, "text-anchor": "middle", "dominant-baseline": "central", class: "map-compass-label" });
    label.textContent = sideLabel;
    mapSvg.appendChild(label);
  }

  for (const gate of venueData.gates) {
    const rect = svgEl("rect", {
      x: gate.x - 0.85,
      y: gate.y - 0.85,
      width: 1.7,
      height: 1.7,
      rx: 0.35,
      class: "map-node",
      fill: densityColor(currentZones[gate.zone]),
      stroke: gate.stepFree ? "none" : "var(--color-danger)",
      "stroke-width": gate.stepFree ? 0 : 0.25,
    });
    drawNodeWithTooltip(rect, `${gate.name}${gate.stepFree ? "" : " (not step-free)"}`);
    mapSvg.appendChild(buildMarkerIcon("gate", gate.x, gate.y, 1.35));

    const label = svgEl("text", { x: gate.x, y: gate.y - 1.25, "text-anchor": "middle", class: "map-label" });
    label.textContent = gate.name.replace("Gate ", "");
    mapSvg.appendChild(label);
  }

  for (const poi of venueData.pointsOfInterest) {
    const circle = svgEl("circle", { cx: poi.x, cy: poi.y, r: 0.85, class: "map-node", fill: densityColor(currentZones[poi.zone]), stroke: "#fff", "stroke-width": 0.12 });
    drawNodeWithTooltip(circle, poi.name);
    mapSvg.appendChild(buildMarkerIcon(poi.type, poi.x, poi.y, 1.15));
  }

  if (lastRoute) renderRouteOverlay(venueData, lastRoute.sectionId, lastRoute.routeResult);
}

function renderMapLegend() {
  const legend = requireEl("map-legend");
  legend.textContent = "";
  for (const [type, label] of LEGEND_ITEMS) {
    const item = document.createElement("span");
    item.className = "map-legend__item";

    const swatch = svgEl("svg", { viewBox: "0 0 24 24", class: "map-legend__swatch" });
    swatch.setAttribute("aria-hidden", "true");
    const bg = type === "gate" ? svgEl("rect", { x: 1, y: 1, width: 22, height: 22, rx: 5 }) : svgEl("circle", { cx: 12, cy: 12, r: 11 });
    bg.style.fill = "var(--color-muted)";
    swatch.appendChild(bg);
    swatch.appendChild(buildIconGroup(type));

    item.appendChild(swatch);
    const text = document.createElement("span");
    text.textContent = label;
    item.appendChild(text);
    legend.appendChild(item);
  }
}
