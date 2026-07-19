/**
 * Express app assembly, kept separate from server/index.js so tests can
 * import the app and issue requests against it without binding a port.
 */
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import venueRouter from "./routes/venue.js";
import conciergeRouter from "./routes/concierge.js";

export function createApp() {
  const app = express();

  // Small payload cap: this API only ever accepts a short query + a few
  // enum fields, so there's no legitimate reason for a large body.
  app.use(express.json({ limit: "10kb" }));

  app.use("/api", venueRouter);
  app.use("/api", conciergeRouter);

  // Local dev only (`npm start`) — on Netlify, static files are served
  // directly by the CDN (see netlify.toml's publish dir + /api/* redirect),
  // so this bundled function never receives those requests. Guarded in a
  // try/catch because Netlify's esbuild function bundler doesn't reliably
  // preserve `import.meta.url`, and this only needs to work locally anyway.
  try {
    const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
    app.use(express.static(publicDir));
  } catch {
    // Bundled serverless context — static assets are served by the
    // platform, not through this Express app. Nothing to do here.
  }

  return app;
}
