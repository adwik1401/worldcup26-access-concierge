/**
 * Vanilla JS frontend — no framework/build step, so `npm start` + opening
 * a browser is the entire setup. All dynamic text is inserted via
 * textContent (never innerHTML) so nothing the server returns — including
 * an LLM-generated reply — can execute as markup in the page.
 */

const RTL_LANGUAGES = new Set(["ar"]);

const chatLog = document.getElementById("chat-log");
const queryForm = document.getElementById("query-form");
const queryInput = document.getElementById("query-input");
const languageSelect = document.getElementById("language-select");
const sectionSelect = document.getElementById("section-select");
const scenarioButtonsContainer = document.getElementById("scenario-buttons");
const contrastToggle = document.getElementById("contrast-toggle");
const fontIncreaseButton = document.getElementById("font-increase");
const fontDecreaseButton = document.getElementById("font-decrease");

initDisplayPreferences();
loadVenue();
loadScenarios();

languageSelect.addEventListener("change", () => {
  document.documentElement.dir = RTL_LANGUAGES.has(languageSelect.value) ? "rtl" : "ltr";
});

queryForm.addEventListener("submit", handleQuerySubmit);

// ---- Display preferences (high contrast / font size), persisted locally ----

function initDisplayPreferences() {
  const contrastOn = localStorage.getItem("a11y-contrast") === "on";
  const fontScale = Number(localStorage.getItem("a11y-font-scale")) || 1;
  applyContrast(contrastOn);
  applyFontScale(fontScale);

  contrastToggle.addEventListener("click", () => {
    const nowOn = !document.documentElement.classList.contains("high-contrast");
    applyContrast(nowOn);
    localStorage.setItem("a11y-contrast", nowOn ? "on" : "off");
  });

  fontIncreaseButton.addEventListener("click", () => adjustFontScale(0.1));
  fontDecreaseButton.addEventListener("click", () => adjustFontScale(-0.1));
}

function applyContrast(on) {
  document.documentElement.classList.toggle("high-contrast", on);
  contrastToggle.setAttribute("aria-pressed", String(on));
}

function applyFontScale(scale) {
  const clamped = Math.min(1.6, Math.max(0.85, scale));
  document.documentElement.style.setProperty("--font-scale", String(clamped));
  localStorage.setItem("a11y-font-scale", String(clamped));
}

function adjustFontScale(delta) {
  const current = Number(getComputedStyle(document.documentElement).getPropertyValue("--font-scale")) || 1;
  applyFontScale(current + delta);
}

// ---- Venue + scenario data ----

async function loadVenue() {
  try {
    const res = await fetch("/api/venue");
    const data = await res.json();
    sectionSelect.innerHTML = "";
    for (const section of data.sections) {
      const option = document.createElement("option");
      option.value = section.id;
      option.textContent = `${section.name} (${section.level})`;
      sectionSelect.appendChild(option);
    }
  } catch (err) {
    sectionSelect.innerHTML = '<option value="">Could not load sections</option>';
  }
}

async function loadScenarios() {
  try {
    const res = await fetch("/api/scenarios");
    const data = await res.json();
    renderScenarioButtons(data.scenarios, data.current);
  } catch (err) {
    scenarioButtonsContainer.textContent = "Could not load crowd scenarios.";
  }
}

function renderScenarioButtons(scenarios, currentKey) {
  scenarioButtonsContainer.innerHTML = "";
  for (const scenario of scenarios) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = scenario.label;
    button.title = scenario.description;
    button.setAttribute("aria-pressed", String(scenario.key === currentKey));
    button.addEventListener("click", () => switchScenario(scenario.key));
    scenarioButtonsContainer.appendChild(button);
  }
}

async function switchScenario(key) {
  try {
    const res = await fetch("/api/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) return;
    // Re-render from the server's confirmed current key rather than
    // trusting the click alone, so the UI can never drift from server state.
    loadScenarios();
  } catch (err) {
    // Non-fatal for a demo toggle — the previous scenario simply stays active.
  }
}

// ---- Chat ----

function getSelectedAccessibilityNeeds() {
  return Array.from(document.querySelectorAll('input[name="accessibilityNeeds"]:checked')).map((el) => el.value);
}

async function handleQuerySubmit(event) {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;

  appendMessage({ role: "user", text: query });
  queryInput.value = "";
  queryInput.focus();

  const pendingId = appendMessage({ role: "assistant", text: "Thinking…", pending: true });

  try {
    const res = await fetch("/api/concierge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        language: languageSelect.value,
        sectionId: sectionSelect.value || undefined,
        accessibilityNeeds: getSelectedAccessibilityNeeds(),
      }),
    });

    const data = await res.json();
    removeMessage(pendingId);

    if (!res.ok) {
      appendMessage({ role: "assistant", text: data.error || "Something went wrong — please try again." });
      return;
    }

    appendMessage({
      role: "assistant",
      text: data.message,
      source: data.source,
      appliedRules: data.route?.appliedRules,
    });
  } catch (err) {
    removeMessage(pendingId);
    appendMessage({ role: "assistant", text: "Couldn't reach the concierge — please check your connection and try again." });
  }
}

let messageCounter = 0;

function appendMessage({ role, text, pending, source, appliedRules }) {
  const id = `msg-${++messageCounter}`;
  const wrapper = document.createElement("div");
  wrapper.className = `message message--${role}`;
  wrapper.id = id;

  const bubble = document.createElement("div");
  bubble.className = "message__bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  if (!pending && role === "assistant" && source) {
    const meta = document.createElement("div");
    meta.className = "message__meta";
    meta.textContent = source === "openrouter" ? "Composed live via OpenRouter" : "Offline multilingual mode (no API key configured)";
    wrapper.appendChild(meta);
  }

  if (appliedRules && appliedRules.length > 0) {
    const details = document.createElement("details");
    details.className = "message__rationale";
    const summary = document.createElement("summary");
    summary.textContent = "Why this recommendation";
    details.appendChild(summary);
    const list = document.createElement("ul");
    for (const rule of appliedRules) {
      const item = document.createElement("li");
      item.textContent = rule;
      list.appendChild(item);
    }
    details.appendChild(list);
    wrapper.appendChild(details);
  }

  chatLog.appendChild(wrapper);
  chatLog.scrollTop = chatLog.scrollHeight;
  return id;
}

function removeMessage(id) {
  document.getElementById(id)?.remove();
}
