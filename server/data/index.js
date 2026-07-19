/**
 * Re-exports the static mock venue/crowd data as plain objects.
 *
 * Uses a direct ESM JSON import (Node's `with { type: "json" }` import
 * attribute) rather than `readFileSync(dirname(fileURLToPath(import.meta.url)))`
 * — that pattern breaks under Netlify's esbuild function bundler, which
 * does not reliably preserve `import.meta.url` when bundling to a single
 * file, so `fileURLToPath` receives `undefined` at runtime. A plain JSON
 * import has no such problem: esbuild resolves and inlines the JSON at
 * bundle time, and Node's native loader resolves it directly at runtime
 * locally — both environments work from the same source with no
 * environment-specific branching.
 */
import venueJson from "./venue.json" with { type: "json" };
import crowdScenariosJson from "./crowdScenarios.json" with { type: "json" };

// Cast (not a checked `@type` declaration) to the general shared shapes
// (Venue, Record<string, CrowdScenario>) rather than TS's literal inference
// straight off the JSON file — which infers e.g. `ring: string` instead of
// the union `"lower" | "upper"`, and types crowdScenarios as an object with
// exactly 3 known keys, too narrow for callers that index it by an
// arbitrary runtime string (crowdState.js's `crowdScenarios[currentKey]`).
// The underlying JSON is static content we control, so widening it here is
// asserting a fact about our own data, not suppressing a real type error.
const venue = /** @type {Venue} */ (venueJson);
const crowdScenarios = /** @type {Record<string, CrowdScenario>} */ (crowdScenariosJson);

export { venue, crowdScenarios };
