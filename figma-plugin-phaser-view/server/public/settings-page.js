const atlasInput = document.getElementById("atlasOutputDir");
const tsInput = document.getElementById("tsOutputDir");
const logNode = document.getElementById("log");
const serverStatus = document.getElementById("serverStatus");
const AUTOSAVE_DELAY_MS = 500;
let autosaveTimer = null;

/**
 * Appends a timestamped message to the page log.
 */
function log(message) {
  const time = new Date().toLocaleTimeString();
  logNode.textContent += "\n[" + time + "] " + message;
  logNode.scrollTop = logNode.scrollHeight;
}

/**
 * Calls a JSON API endpoint and throws on non-ok responses.
 */
async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok || !payload || payload.ok === false) {
    throw new Error(payload && payload.error ? payload.error : text || "HTTP " + response.status);
  }

  return payload;
}

/**
 * Writes loaded settings into the form.
 */
function renderSettings(settings) {
  atlasInput.value = settings.atlasOutputDir;
  tsInput.value = settings.tsOutputDir;
}

/**
 * Loads server diagnostics and current output paths.
 */
async function loadInitialState() {
  const payload = await requestJson("/api/server/health");
  serverStatus.textContent = "Server running on http://localhost:" + payload.port;
  renderSettings({
    atlasOutputDir: payload.atlasOutputDir,
    tsOutputDir: payload.tsOutputDir,
  });
  log("Settings loaded.");
}

/**
 * Saves manually edited output paths to the server settings file.
 */
async function saveSettings(options = {}) {
  const payload = await requestJson("/api/server/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      atlasOutputDir: atlasInput.value,
      tsOutputDir: tsInput.value,
    }),
  });
  renderSettings(payload.settings);
  log(options.autosave ? "Settings autosaved." : "Settings saved.");
}

/**
 * Saves changed paths shortly after the user edits an input.
 */
function scheduleAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }

  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    saveSettings({ autosave: true }).catch((error) => log("ERROR: " + error.message));
  }, AUTOSAVE_DELAY_MS);
}

/**
 * Opens the native folder picker through the server API.
 */
async function chooseDirectory(kind) {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  const payload = await requestJson("/api/server/choose-directory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      atlasOutputDir: atlasInput.value,
      tsOutputDir: tsInput.value,
    }),
  });
  renderSettings(payload.settings);
  log((kind === "atlas" ? "Atlas" : "TS") + " folder saved: " + payload.directory);
}

/**
 * Validates that configured output folders are writable.
 */
async function validateSettings() {
  const payload = await requestJson("/api/server/validate-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      atlasOutputDir: atlasInput.value,
      tsOutputDir: tsInput.value,
    }),
  });
  log(JSON.stringify(payload.checks, null, 2));
}

document.getElementById("saveSettings").addEventListener("click", () => {
  saveSettings().catch((error) => log("ERROR: " + error.message));
});

document.getElementById("validateSettings").addEventListener("click", () => {
  validateSettings().catch((error) => log("ERROR: " + error.message));
});

document.getElementById("chooseAtlas").addEventListener("click", () => {
  chooseDirectory("atlas").catch((error) => log("ERROR: " + error.message));
});

document.getElementById("chooseTs").addEventListener("click", () => {
  chooseDirectory("ts").catch((error) => log("ERROR: " + error.message));
});

atlasInput.addEventListener("input", scheduleAutosave);
tsInput.addEventListener("input", scheduleAutosave);

loadInitialState().catch((error) => log("ERROR: " + error.message));
