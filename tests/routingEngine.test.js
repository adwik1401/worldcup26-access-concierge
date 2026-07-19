import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectIntent,
  meetsAccessibilityNeeds,
  distance,
  scorePOI,
  rankPOIs,
  findGateForSection,
  findRoute,
} from "../server/engine/routingEngine.js";
import { venue, crowdScenarios } from "../server/data/index.js";

test("detectIntent matches known facility keywords", () => {
  assert.equal(detectIntent("Where is the nearest restroom?"), "restroom");
  assert.equal(detectIntent("I need a doctor, I'm hurt"), "medical");
  assert.equal(detectIntent("Is there a quiet room somewhere?"), "quiet_room");
  assert.equal(detectIntent("Can you help me find my seat"), "seat");
  assert.equal(detectIntent("asdkjhaskjdh"), "unknown");
});

/**
 * meetsAccessibilityNeeds and scorePOI only ever read a handful of
 * PointOfInterest fields (stepFree/type/lowSensory/x/y/zone) — these
 * fixtures deliberately specify only what each test exercises, per usual
 * test-double practice, then cast to the full type rather than padding
 * every fixture with irrelevant id/name/accessible values.
 * @param {Partial<PointOfInterest>} fields
 * @returns {PointOfInterest}
 */
function mockPoi(fields) {
  return /** @type {PointOfInterest} */ (fields);
}

test("meetsAccessibilityNeeds excludes non-step-free POIs for a mobility profile", () => {
  const stepFreePoi = mockPoi({ stepFree: true, type: "restroom" });
  const stairsOnlyPoi = mockPoi({ stepFree: false, type: "restroom" });
  assert.equal(meetsAccessibilityNeeds(stepFreePoi, { mobility: true }), true);
  assert.equal(meetsAccessibilityNeeds(stairsOnlyPoi, { mobility: true }), false);
  // Without a mobility profile, a non-step-free POI is still a valid option.
  assert.equal(meetsAccessibilityNeeds(stairsOnlyPoi, {}), true);
});

test("meetsAccessibilityNeeds requires lowSensory quiet rooms for sensory-sensitivity profile", () => {
  const quietLowSensory = mockPoi({ type: "quiet_room", lowSensory: true, stepFree: true });
  const quietNotLowSensory = mockPoi({ type: "quiet_room", lowSensory: false, stepFree: true });
  assert.equal(meetsAccessibilityNeeds(quietLowSensory, { sensorySensitivity: true }), true);
  assert.equal(meetsAccessibilityNeeds(quietNotLowSensory, { sensorySensitivity: true }), false);
});

test("distance is symmetric Euclidean distance", () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(distance({ x: 3, y: 4 }, { x: 0, y: 0 }), 5);
});

test("scorePOI penalizes crowd density more heavily for a mobility profile than a general one", () => {
  const poi = mockPoi({ x: 10, y: 0, zone: "zone-a" });
  const origin = { x: 0, y: 0 };
  const crowdZones = { "zone-a": 0.9 };

  const generalScore = scorePOI(poi, origin, crowdZones, {});
  const mobilityScore = scorePOI(poi, origin, crowdZones, { mobility: true });

  assert.ok(mobilityScore > generalScore, "mobility profile should weight the same crowd density more heavily");
});

test("rankPOIs excludes inaccessible POIs and sorts by score ascending", () => {
  const origin = { x: 0, y: 0 };
  const crowdZones = { "zone-a": 0, "zone-b": 0 };
  const pois = [
    mockPoi({ id: "far-empty", type: "restroom", x: 20, y: 0, zone: "zone-b", stepFree: true }),
    mockPoi({ id: "near-empty", type: "restroom", x: 1, y: 0, zone: "zone-a", stepFree: true }),
    mockPoi({ id: "near-not-stepfree", type: "restroom", x: 0.5, y: 0, zone: "zone-a", stepFree: false }),
  ];

  const ranked = rankPOIs(pois, origin, crowdZones, { mobility: true });

  assert.equal(ranked.length, 2, "the non-step-free POI must be excluded for a mobility profile");
  assert.equal(ranked[0].poi.id, "near-empty", "the nearer accessible POI should rank first");
});

test("findGateForSection routes a mobility profile away from a non-step-free nearest gate", () => {
  const section = venue.sections.find((s) => s.id === "sec-140"); // nearest gate is gate-d, which is not step-free
  assert.ok(section, "fixture venue must have a sec-140 section");
  const { gate, rules } = findGateForSection(venue, section, { mobility: true });

  assert.ok(gate, "a step-free gate must be found");
  assert.notEqual(gate.id, "gate-d");
  assert.equal(gate.stepFree, true);
  assert.ok(rules.some((r) => r.includes("not step-free")));
});

test("findGateForSection uses the nearest gate outright when there's no mobility constraint", () => {
  const section = venue.sections.find((s) => s.id === "sec-140");
  assert.ok(section, "fixture venue must have a sec-140 section");
  const { gate } = findGateForSection(venue, section, {});
  assert.ok(gate);
  assert.equal(gate.id, "gate-d");
});

test("findRoute flags a high-density recommendation and offers alternatives", () => {
  const result = findRoute({
    venue,
    crowdZones: crowdScenarios["gate-b-surge"].zones,
    profile: { mobility: true },
    query: "where is the nearest restroom",
    sectionId: "sec-112",
  });

  assert.equal(result.intent, "restroom");
  assert.ok(result.chosen);
  assert.equal(result.chosen.stepFree, true);
  assert.ok(result.chosen.crowdDensity !== undefined && result.chosen.crowdDensity >= 0.7);
  assert.ok(result.appliedRules.some((r) => r.includes("high-density")));
  assert.ok(result.alternatives.length > 0);
});

test("findRoute falls back to info_desk for an unrecognized query", () => {
  const result = findRoute({
    venue,
    crowdZones: crowdScenarios.normal.zones,
    profile: {},
    query: "blah blah nonsense",
    sectionId: "sec-101",
  });

  assert.equal(result.intent, "unknown");
  assert.ok(result.chosen);
  assert.equal(result.chosen.type, "info_desk");
});

test("findRoute reports no route when a seat query is missing a section", () => {
  const result = findRoute({
    venue,
    crowdZones: crowdScenarios.normal.zones,
    profile: {},
    query: "find my seat",
    sectionId: undefined,
  });

  assert.equal(result.chosen, null);
  assert.ok(result.appliedRules[0].toLowerCase().includes("seat section"));
});
