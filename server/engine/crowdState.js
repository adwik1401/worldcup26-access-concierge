/**
 * In-memory "which crowd scenario is currently active" state, standing in
 * for a live density feed. Deliberately process-local and non-persistent —
 * this is a demo toggle (see routes/venue.js POST /api/scenario), not a
 * real telemetry ingestion pipeline, and resets to "normal" on restart.
 */
import { crowdScenarios } from "../data/index.js";

let currentKey = "normal";

/** @returns {string} the currently active scenario's key */
export function getCurrentScenarioKey() {
  return currentKey;
}

/** @returns {CrowdZones} zone id -> density map for the currently active scenario */
export function getCurrentScenarioZones() {
  return crowdScenarios[currentKey].zones;
}

/** @returns {Array<{ key: string, label: string, description: string }>} */
export function listScenarios() {
  return Object.entries(crowdScenarios).map(([key, v]) => ({
    key,
    label: v.label,
    description: v.description,
  }));
}

/**
 * @param {string} key
 * @returns {boolean} whether `key` was a recognized scenario and was applied
 */
export function setScenario(key) {
  if (!crowdScenarios[key]) return false;
  currentKey = key;
  return true;
}
