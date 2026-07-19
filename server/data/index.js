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
import venue from "./venue.json" with { type: "json" };
import crowdScenarios from "./crowdScenarios.json" with { type: "json" };

export { venue, crowdScenarios };
