import { Router } from "express";
import { venue } from "../data/index.js";
import { findRoute } from "../engine/routingEngine.js";
import { composeReply } from "../engine/llmClient.js";
import { SUPPORTED_LANGUAGES } from "../engine/i18n.js";
import { getCurrentScenarioZones } from "../engine/crowdState.js";

const router = Router();

/** @type {Array<keyof AccessibilityProfile>} */
const VALID_ACCESSIBILITY_KEYS = ["mobility", "visualImpairment", "hearingImpairment", "sensorySensitivity"];
const MAX_QUERY_LENGTH = 300;

// Basic in-memory per-IP rate limit — no external store needed for a
// single-process demo; protects the (potentially paid) OpenRouter call
// from casual abuse without adding a Redis/dependency for this scale.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
/** @type {Map<string, number[]>} */
const requestTimestampsByIp = new Map();

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isRateLimited(ip) {
  const now = Date.now();
  const recent = (requestTimestampsByIp.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestTimestampsByIp.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Validates and normalizes the request body.
 * @param {any} body - untyped external HTTP input, validated field-by-field below
 * @returns {{ error: string } | { profile: AccessibilityProfile, query: string, language: string, sectionId: string | undefined }}
 */
function parseConciergeRequest(body) {
  const { query, language, sectionId, accessibilityNeeds } = body || {};

  if (typeof query !== "string" || query.trim().length === 0) {
    return { error: "`query` must be a non-empty string." };
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return { error: `\`query\` must be under ${MAX_QUERY_LENGTH} characters.` };
  }
  if (language !== undefined && !SUPPORTED_LANGUAGES.includes(language)) {
    return { error: `\`language\` must be one of: ${SUPPORTED_LANGUAGES.join(", ")}` };
  }
  if (sectionId !== undefined && typeof sectionId !== "string") {
    return { error: "`sectionId` must be a string." };
  }
  if (
    accessibilityNeeds !== undefined &&
    (!Array.isArray(accessibilityNeeds) || accessibilityNeeds.some((k) => !VALID_ACCESSIBILITY_KEYS.includes(k)))
  ) {
    return { error: `\`accessibilityNeeds\` must be an array drawn from: ${VALID_ACCESSIBILITY_KEYS.join(", ")}` };
  }

  // Validated by the Array.isArray + VALID_ACCESSIBILITY_KEYS check above —
  // this cast names that already-proven fact instead of re-deriving it.
  const validatedNeeds = /** @type {Array<keyof AccessibilityProfile>} */ (accessibilityNeeds || []);
  const profile = /** @type {AccessibilityProfile} */ (Object.fromEntries(validatedNeeds.map((key) => [key, true])));
  return { profile, query: query.trim(), language: language || "en", sectionId };
}

router.post("/concierge", async (req, res) => {
  // Falls back to a shared "unknown" bucket if the platform doesn't supply
  // an IP (e.g. trust proxy misconfigured) — conservative, not a crash risk.
  if (isRateLimited(req.ip ?? "unknown")) {
    return res.status(429).json({ error: "Too many requests — please wait a moment and try again." });
  }

  const parsed = parseConciergeRequest(req.body);
  if ("error" in parsed) {
    return res.status(400).json({ error: parsed.error });
  }

  const { profile, query, language, sectionId } = parsed;
  const crowdZones = getCurrentScenarioZones();

  const routeResult = findRoute({ venue, crowdZones, profile, query, sectionId });
  const { message, source } = await composeReply({ routeResult, query, language });

  res.json({ message, source, route: routeResult });
});

export default router;
