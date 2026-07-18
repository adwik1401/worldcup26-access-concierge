/**
 * Express app assembly, kept separate from server/index.js so tests can
 * import the app and issue requests against it without binding a port.
 */
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import venueRouter from "./routes/venue.js";
import conciergeRouter from "./routes/concierge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // Small payload cap: this API only ever accepts a short query + a few
  // enum fields, so there's no legitimate reason for a large body.
  app.use(express.json({ limit: "10kb" }));

  app.use("/api", venueRouter);
  app.use("/api", conciergeRouter);
  app.use(express.static(join(__dirname, "..", "public")));

  return app;
}
