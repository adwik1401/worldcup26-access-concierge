/**
 * In-memory "which crowd scenario is currently active" state, standing in
 * for a live density feed. Deliberately process-local and non-persistent —
 * this is a demo toggle (see routes/venue.js POST /api/scenario), not a
 * real telemetry ingestion pipeline, and resets to "normal" on restart.
 */
import { crowdScenarios } from "../data/index.js";

let currentKey = "normal";

export function getCurrentScenarioKey() {
  return currentKey;
}

export function getCurrentScenarioZones() {
  return crowdScenarios[currentKey].zones;
}

export function listScenarios() {
  return Object.entries(crowdScenarios).map(([key, v]) => ({
    key,
    label: v.label,
    description: v.description,
  }));
}

/** @returns {boolean} whether `key` was a recognized scenario and was applied */
export function setScenario(key) {
  if (!crowdScenarios[key]) return false;
  currentKey = key;
  return true;
}
