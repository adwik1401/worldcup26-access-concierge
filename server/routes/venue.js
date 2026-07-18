import { Router } from "express";
import { venue } from "../data/index.js";
import { getCurrentScenarioKey, listScenarios, setScenario } from "../engine/crowdState.js";

const router = Router();

/** Venue map data for populating the frontend's gate/section selectors. */
router.get("/venue", (req, res) => {
  res.json({
    venueName: venue.venueName,
    venueNote: venue.venueNote,
    gates: venue.gates.map(({ id, name, stepFree }) => ({ id, name, stepFree })),
    sections: venue.sections.map(({ id, name, level }) => ({ id, name, level })),
  });
});

/** Lists demo crowd-density scenarios and which one is currently active. */
router.get("/scenarios", (req, res) => {
  res.json({ current: getCurrentScenarioKey(), scenarios: listScenarios() });
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
