/**
 * Netlify Functions entry point — wraps the same Express app used by
 * `npm start` (server/app.js) via serverless-http, so there is exactly one
 * source of truth for routes/validation/rate-limiting, not a parallel
 * implementation to keep in sync.
 *
 * Netlify's redirect (see netlify.toml) forwards `/api/*` requests to this
 * function at `/.netlify/functions/api/...`. Express's own routers are
 * mounted at `/api/...` (see app.js) to match local dev exactly, so the
 * function-path prefix is rewritten back to `/api` before handing the
 * request to Express — otherwise Express would 404 on every request
 * (this is the standard Netlify+Express+serverless-http gotcha).
 *
 * Known limitation: the crowd-scenario demo toggle (crowdState.js) is
 * in-memory. On Netlify's serverless runtime that state is only reliably
 * shared across requests that land on the same warm function instance —
 * unlike `npm start`, where one long-lived process guarantees it. Fine for
 * a demo session, called out explicitly in the README rather than silently
 * assumed.
 */
import serverless from "serverless-http";
import { createApp } from "../../server/app.js";

const expressHandler = serverless(createApp());
const FUNCTION_PREFIX = "/.netlify/functions/api";

export const handler = async (event, context) => {
  if (event.path.startsWith(FUNCTION_PREFIX)) {
    event.path = "/api" + event.path.slice(FUNCTION_PREFIX.length);
  }
  return expressHandler(event, context);
};
