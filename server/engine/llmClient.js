/**
 * GenAI composition layer, via OpenRouter (https://openrouter.ai) — an
 * OpenAI-compatible REST gateway to many model providers behind a single
 * API key. Called with the platform `fetch` (Node >=18), so no vendor SDK
 * dependency is needed.
 *
 * This module NEVER decides the route — it only phrases the structured
 * result already produced by routingEngine.js, grounded strictly in the
 * venue data passed as context. If no API key is configured, or the call
 * fails or times out, it transparently falls back to the fully offline,
 * deterministic i18n composer so the app never breaks for lack of a key.
 */

import { composeOfflineMessage, distanceBucket } from "./i18n.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const REQUEST_TIMEOUT_MS = 8000;

/** @type {Record<SupportedLanguage, string>} */
const LANGUAGE_NAMES = { en: "English", es: "Spanish", fr: "French", pt: "Portuguese", ar: "Arabic" };
/** @type {Record<DistanceBucket, string>} */
const DISTANCE_DESCRIPTIONS = { veryClose: "very close by", short: "a short walk away", far: "a bit of a walk away" };

/**
 * Strips raw x/y coordinates and the unitless grid `distance` number out of
 * a POI before it reaches the model, replacing distance with a qualitative
 * description. A bare "distance: 1.4" has no unit — an LLM asked to phrase
 * it will happily invent one ("140 meters"), which is exactly the kind of
 * fabrication the system prompt otherwise forbids. crowdDensity is kept,
 * since it's already an unambiguous percentage.
 * @param {RouteChosen | null} poi
 * @returns {(Omit<RouteChosen, "x" | "y" | "distance"> & { distanceDescription?: string }) | null}
 */
function sanitizePoiForPrompt(poi) {
  if (!poi) return poi;
  const { x: _x, y: _y, distance, ...rest } = poi;
  return distance === undefined ? rest : { ...rest, distanceDescription: DISTANCE_DESCRIPTIONS[distanceBucket(distance)] };
}

/**
 * @param {RouteResult} routeResult
 * @returns {object} a prompt-safe copy of routeResult (see sanitizePoiForPrompt)
 */
function sanitizeRouteResultForPrompt(routeResult) {
  return {
    ...routeResult,
    chosen: sanitizePoiForPrompt(routeResult.chosen),
    alternatives: (routeResult.alternatives || []).map(sanitizePoiForPrompt),
  };
}

/**
 * @param {string} language
 * @returns {string}
 */
function buildSystemPrompt(language) {
  const languageName = LANGUAGE_NAMES[/** @type {SupportedLanguage} */ (language)] || "English";
  return [
    "You are an accessibility and navigation concierge for fans at a FIFA World Cup 2026 venue.",
    "You will be given a structured routing decision (JSON) that has already been computed by a",
    "deterministic rules engine — your ONLY job is to phrase that decision as a warm, concise,",
    `plain-language reply IN ${languageName.toUpperCase()}. Rules:`,
    "- Never invent facilities, distances, or crowd data not present in the JSON.",
    "- Distances are given as qualitative descriptions (e.g. \"a short walk away\"), never as a",
    "  number of meters/feet/minutes — do not invent a unit or a specific figure.",
    "- Keep the reply under 60 words.",
    "- If the JSON shows an accessibility override (e.g. a nearer gate was skipped because it",
    "  wasn't step-free), briefly explain why, so the fan trusts the recommendation.",
    "- If a crowd-density warning is present, mention it plainly without alarm.",
    "- Do not use markdown formatting.",
  ].join(" ");
}

/**
 * Compose a fan-facing reply for a routing-engine result. Always resolves
 * (never throws) — failures degrade to the offline path.
 * @param {object} args
 * @param {RouteResult} args.routeResult
 * @param {string} args.query
 * @param {string} args.language
 * @returns {Promise<ConciergeReply>}
 */
export async function composeReply({ routeResult, query, language }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { message: composeOfflineMessage(routeResult, language), source: "offline" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
        max_tokens: 200,
        messages: [
          { role: "system", content: buildSystemPrompt(language) },
          {
            role: "user",
            content: `Fan's question: "${query}"\n\nRouting decision (JSON):\n${JSON.stringify(sanitizeRouteResultForPrompt(routeResult))}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenRouter responded with status ${response.status}: ${body}`);
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message?.content?.trim();
    if (!message) throw new Error("OpenRouter response missing message content");

    return { message, source: "openrouter" };
  } catch (err) {
    // Network error, timeout, non-2xx, or malformed response — log for
    // operators (never surfaced to the fan) and degrade gracefully.
    // `err` is `unknown` under strict typing — Error is the expected shape,
    // but stay safe against anything else a fetch/JSON call could throw.
    console.error("OpenRouter call failed, falling back to offline mode:", err instanceof Error ? err.message : String(err));
    return { message: composeOfflineMessage(routeResult, language), source: "offline-fallback-error" };
  } finally {
    clearTimeout(timeout);
  }
}
