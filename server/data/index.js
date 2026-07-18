/**
 * Loads the static mock venue/crowd data once at module init (small,
 * read-only JSON — no benefit to re-reading per request) and re-exports it
 * as plain objects for the rest of the app.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const venue = JSON.parse(readFileSync(join(__dirname, "venue.json"), "utf-8"));
export const crowdScenarios = JSON.parse(readFileSync(join(__dirname, "crowdScenarios.json"), "utf-8"));
