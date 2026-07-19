/**
 * Deterministic accessibility-aware routing engine.
 *
 * This module contains no LLM calls and no I/O — every export is a pure
 * function of its arguments. That is a deliberate design choice: the
 * safety-relevant decision ("which route/facility should this fan be sent
 * to?") must be reproducible and unit-testable independent of any GenAI
 * call. The LLM layer (see llmClient.js) only phrases the result returned
 * from here — it never decides the route itself.
 */

/**
 * Keyword → intent map used by detectIntent(). Order matters: first match
 * wins, so specific facility types are checked before "info_desk" — its
 * keywords ("help", "assistance") are generic enough to appear inside an
 * otherwise-specific query (e.g. "can you help me find my seat") and would
 * otherwise shadow the real intent if checked first.
 */
/** @type {Array<[RouteIntent, string[]]>} */
const INTENT_KEYWORDS = [
  ["restroom", ["restroom", "bathroom", "toilet", "washroom", "baño", "toilette"]],
  ["elevator", ["elevator", "lift", "stairs", "escalator", "ramp"]],
  ["medical", ["medical", "doctor", "nurse", "first aid", "injury", "hurt", "sick", "paramedic"]],
  ["quiet_room", ["quiet", "sensory", "overwhelmed", "calm", "break room", "meltdown", "anxious"]],
  ["seat", ["seat", "section", "my seat", "find my seat"]],
  ["concession", ["food", "drink", "concession", "snack", "water", "hungry", "thirsty"]],
  ["info_desk", ["help", "information", "info desk", "guest services", "lost", "assistance"]],
];

/**
 * Infer the fan's intent from a free-text query using simple keyword
 * matching. Deliberately not an LLM call — intent classification here is
 * a bounded, low-ambiguity problem (a handful of facility types), so a
 * transparent rule-based approach is both cheaper and more auditable
 * than a model call for this step.
 * @param {string} queryText
 * @returns {RouteIntent} one of the keys in INTENT_KEYWORDS, or "unknown"
 */
export function detectIntent(queryText) {
  const text = (queryText || "").toLowerCase();
  for (const [intent, keywords] of INTENT_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) return intent;
  }
  return "unknown";
}

/**
 * Euclidean distance between two {x,y} points on the venue's concourse grid.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Whether a point of interest satisfies the fan's stated accessibility needs.
 * @param {PointOfInterest} poi
 * @param {AccessibilityProfile} profile
 * @returns {boolean}
 */
export function meetsAccessibilityNeeds(poi, profile) {
  if (profile.mobility && !poi.stepFree) return false;
  if (profile.sensorySensitivity && poi.type === "quiet_room" && !poi.lowSensory) return false;
  return true;
}

/**
 * Score a POI for ranking: lower is better. Combines straight-line
 * distance from the fan's origin with a crowd-density penalty, so a
 * closer-but-jammed facility can rank behind a farther-but-clear one.
 * The penalty is weighted more heavily for mobility/sensory profiles,
 * for whom moving through a dense crowd is a bigger cost than for a
 * fan with no stated accessibility needs.
 * @param {PointOfInterest} poi
 * @param {{x: number, y: number}} origin
 * @param {CrowdZones} crowdZones zone id -> density in [0,1]
 * @param {AccessibilityProfile} profile
 * @returns {number}
 */
export function scorePOI(poi, origin, crowdZones, profile) {
  const dist = distance(origin, poi);
  const density = crowdZones[poi.zone] ?? 0;
  const crowdWeight = profile.mobility || profile.sensorySensitivity ? 3 : 1.2;
  return dist * (1 + density * crowdWeight);
}

/**
 * Filter, score, and rank a venue's points of interest for a given fan
 * profile and origin. Returns best-to-worst order; entries that fail the
 * accessibility filter are excluded entirely rather than merely
 * deprioritized, since an inaccessible route is not a usable option.
 * @param {PointOfInterest[]} pois
 * @param {{x: number, y: number}} origin
 * @param {CrowdZones} crowdZones
 * @param {AccessibilityProfile} profile
 * @returns {RankedPoi[]}
 */
export function rankPOIs(pois, origin, crowdZones, profile) {
  return pois
    .filter((poi) => meetsAccessibilityNeeds(poi, profile))
    .map((poi) => ({
      poi,
      score: scorePOI(poi, origin, crowdZones, profile),
      distance: distance(origin, poi),
      crowdDensity: crowdZones[poi.zone] ?? 0,
    }))
    .sort((a, b) => a.score - b.score);
}

/**
 * Choose which gate a fan should use to reach their seat, preferring the
 * geographically nearest gate but overriding that choice when it would
 * violate a stated accessibility need (e.g. a wheelchair user routed away
 * from a stairs-only gate). Returns the chosen gate plus a human-readable
 * rationale so the override (if any) is never silent.
 * @param {Venue} venue
 * @param {VenueSection} section
 * @param {AccessibilityProfile} profile
 * @returns {{ gate: Gate | undefined, rules: string[] }}
 */
export function findGateForSection(venue, section, profile) {
  const candidateGates = profile.mobility
    ? venue.gates.filter((g) => g.stepFree)
    : venue.gates;

  const ranked = candidateGates
    .map((gate) => ({ gate, distance: distance(section, gate) }))
    .sort((a, b) => a.distance - b.distance);

  const nearestOverall = [...venue.gates].sort(
    (a, b) => distance(section, a) - distance(section, b)
  )[0];
  const chosen = ranked[0]?.gate;

  const rules = [];
  if (profile.mobility && chosen && chosen.id !== nearestOverall.id) {
    rules.push(
      `${nearestOverall.name} is geographically closest to ${section.name}, but is not step-free — routed to ${chosen.name} instead (wheelchair/mobility profile).`
    );
  } else if (chosen) {
    rules.push(`${chosen.name} is the nearest gate to ${section.name}.`);
  }

  return { gate: chosen, rules };
}

/**
 * Main entry point: resolve a fan's query into a concrete, explainable
 * recommendation. Combines intent detection, accessibility filtering, and
 * crowd-aware ranking into one structured result that the GenAI layer can
 * phrase for the fan — the routing decision itself never touches an LLM.
 *
 * @param {object} args
 * @param {Venue} args.venue - parsed venue.json
 * @param {CrowdZones} args.crowdZones - zone id -> density in [0,1]
 * @param {AccessibilityProfile} args.profile
 * @param {string} args.query - fan's free-text question
 * @param {string} [args.sectionId] - fan's seat section, if known
 * @returns {RouteResult}
 */
export function findRoute({ venue, crowdZones, profile, query, sectionId }) {
  const intent = detectIntent(query);
  const section = venue.sections.find((s) => s.id === sectionId) || null;
  const origin = section || venue.gates[0]; // fall back to a default origin if no seat given
  const appliedRules = [];

  if (profile.mobility) appliedRules.push("Restricted results to step-free facilities (mobility/wheelchair profile).");
  if (profile.sensorySensitivity) appliedRules.push("Weighted crowd density more heavily and required low-sensory quiet spaces (sensory-sensitivity profile).");

  if (intent === "seat") {
    if (!section) {
      return { intent, chosen: null, alternatives: [], appliedRules: ["No seat section provided — cannot compute a seat route."], crowdSnapshot: crowdZones };
    }
    const { gate, rules } = findGateForSection(venue, section, profile);
    return {
      intent,
      chosen: gate ? { type: "gate", ...gate, targetSection: section.name } : null,
      alternatives: [],
      appliedRules: [...appliedRules, ...rules],
      crowdSnapshot: crowdZones,
    };
  }

  const poiType = intent === "unknown" ? "info_desk" : intent;
  if (intent === "unknown") {
    appliedRules.push("Query didn't match a known facility type — defaulting to the nearest guest services desk.");
  }

  const candidates = venue.pointsOfInterest.filter((p) => p.type === poiType);
  const ranked = rankPOIs(candidates, origin, crowdZones, profile);

  if (ranked.length === 0) {
    return { intent, chosen: null, alternatives: [], appliedRules: [...appliedRules, `No accessible ${poiType.replace("_", " ")} found matching this profile.`], crowdSnapshot: crowdZones };
  }

  const [best, ...rest] = ranked;
  if (best.crowdDensity >= 0.7) {
    appliedRules.push(`Nearest matching facility (${best.poi.name}) is in a high-density zone (${Math.round(best.crowdDensity * 100)}%) — consider an alternative if it's not urgent.`);
  }

  return {
    intent,
    chosen: { ...best.poi, distance: best.distance, crowdDensity: best.crowdDensity },
    alternatives: rest.slice(0, 2).map((r) => ({ ...r.poi, distance: r.distance, crowdDensity: r.crowdDensity })),
    appliedRules,
    crowdSnapshot: crowdZones,
  };
}
