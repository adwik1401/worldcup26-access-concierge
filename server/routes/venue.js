import { Router } from "express";
import { venue } from "../data/index.js";
import { getCurrentScenarioKey, getCurrentScenarioZones, listScenarios, setScenario } from "../engine/crowdState.js";

const router = Router();

/**
 * Venue map data: gate/section selector options plus x/y/zone coordinates
 * for every gate, section, and point of interest, so the frontend can
 * render a live top-down map (see public/app.js renderMap()). This is all
 * illustrative mock data — safe to expose in full.
 */
router.get("/venue", (req, res) => {
  res.json({
    venueName: venue.venueName,
    venueNote: venue.venueNote,
    gates: venue.gates,
    sections: venue.sections,
    pointsOfInterest: venue.pointsOfInterest,
  });
});

/**
 * Lists demo crowd-density scenarios, which one is currently active, and
 * that scenario's zone -> density map (so the map can color-code markers
 * without a second round trip).
 */
router.get("/scenarios", (req, res) => {
  res.json({ current: getCurrentScenarioKey(), zones: getCurrentScenarioZones(), scenarios: listScenarios() });
});

/** Demo-only: switch the "live" crowd-density scenario the routing engine reads from. */
router.post("/scenario", (req, res) => {
  const { key } = req.body || {};
  if (typeof key !== "string" || !setScenario(key)) {
    return res.status(400).json({ error: "Unknown scenario key." });
  }
  res.json({ current: getCurrentScenarioKey() });
});

export default router;
