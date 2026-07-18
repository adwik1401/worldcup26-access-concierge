import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";

// Force the offline path regardless of the developer's local .env, so this
// suite is deterministic and never makes a real network call.
delete process.env.OPENROUTER_API_KEY;

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
});

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("GET /api/venue returns gates and sections", async () => {
  const res = await fetch(`${baseUrl}/api/venue`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(data.gates) && data.gates.length > 0);
  assert.ok(Array.isArray(data.sections) && data.sections.length > 0);
});

test("GET /api/scenarios lists scenarios with a current key", async () => {
  const res = await fetch(`${baseUrl}/api/scenarios`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.scenarios.some((s) => s.key === "normal"));
  assert.ok(typeof data.current === "string");
});

test("POST /api/scenario rejects an unknown scenario key", async () => {
  const { status, body } = await postJson("/api/scenario", { key: "not-a-real-scenario" });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test("POST /api/scenario applies a valid key, and the concierge route reflects it", async () => {
  const setResult = await postJson("/api/scenario", { key: "gate-b-surge" });
  assert.equal(setResult.status, 200);
  assert.equal(setResult.body.current, "gate-b-surge");

  const { status, body } = await postJson("/api/concierge", {
    query: "where is the nearest restroom",
    language: "en",
    sectionId: "sec-112",
    accessibilityNeeds: ["mobility"],
  });

  assert.equal(status, 200);
  assert.equal(body.source, "offline"); // no OPENROUTER_API_KEY set in this suite
  assert.ok(body.route.chosen.crowdDensity >= 0.7, "should reflect the gate-b-surge scenario just applied");

  // Reset for subsequent tests/manual runs.
  await postJson("/api/scenario", { key: "normal" });
});

test("POST /api/concierge returns a localized offline message", async () => {
  const { status, body } = await postJson("/api/concierge", {
    query: "find my seat",
    language: "es",
    sectionId: "sec-140",
    accessibilityNeeds: ["mobility"],
  });

  assert.equal(status, 200);
  assert.equal(body.source, "offline");
  assert.match(body.message, /Gate A/); // Spanish template still names the gate literally
});

test("POST /api/concierge rejects an empty query", async () => {
  const { status, body } = await postJson("/api/concierge", { query: "   " });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test("POST /api/concierge rejects an unsupported language", async () => {
  const { status, body } = await postJson("/api/concierge", { query: "hi", language: "xx" });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test("POST /api/concierge rejects an unknown accessibility-need key", async () => {
  const { status, body } = await postJson("/api/concierge", {
    query: "hi",
    accessibilityNeeds: ["not-a-real-need"],
  });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test("POST /api/concierge rate-limits after repeated requests from the same client", async () => {
  const requests = Array.from({ length: 25 }, () => postJson("/api/concierge", { query: "hello" }));
  const results = await Promise.all(requests);
  assert.ok(results.some((r) => r.status === 429), "expected at least one 429 once the per-IP limit is exceeded");
});
