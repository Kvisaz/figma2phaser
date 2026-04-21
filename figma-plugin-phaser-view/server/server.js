const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { packAsync } = require("free-tex-packer-core");

const PORT = 3456;
const SETTINGS_FILE_PATH = path.join(__dirname, "settings.local.json");

/**
 * Значения по умолчанию. Их можно переопределить из UI плагина.
 */
const GAME_ROOT_DIR = "/Users/sergeytokarev/work_my/YOUR_GAME_PROJECT";

/**
 * Куда писать atlas png/json.
 * Это файловая папка в проекте игры.
 */
const ATLAS_OUTPUT_DIR = path.join(GAME_ROOT_DIR, "public", "assets", "atlases");

/**
 * Куда писать сгенерированные ts-файлы.
 */
const SCENE_OUTPUT_DIR = path.join(GAME_ROOT_DIR, "src", "autogen");

/**
 * Максимальный размер JSON body.
 */
const MAX_BODY_SIZE_BYTES = 200 * 1024 * 1024;

function sendJson(response, statusCode, payload) {
    const body = JSON.stringify(payload, null, 2);

    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    });

    response.end(body);
}

function sendHtml(response, statusCode, html) {
    response.writeHead(statusCode, {
        "Content-Type": "text/html; charset=utf-8",
    });
    response.end(html);
}

function ensureDirectoryExists(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}

function writeTextFile(filePath, content) {
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf8");
}

function writeBinaryFile(filePath, buffer) {
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, buffer);
}

function escapeHtml(input) {
    return String(input || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function createSettingsPageHtml() {
    const settings = readSettings();
    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Figma Phaser Export Server</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f4f1ea;
      color: #211f1a;
    }

    body {
      margin: 0;
      padding: 32px;
    }

    main {
      max-width: 880px;
      margin: 0 auto;
      display: grid;
      gap: 18px;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      letter-spacing: -0.03em;
    }

    .card {
      border: 1px solid #d6cfc1;
      border-radius: 18px;
      padding: 18px;
      background: #fffaf0;
      box-shadow: 0 18px 50px rgb(62 47 26 / 10%);
    }

    .grid {
      display: grid;
      gap: 14px;
    }

    label {
      display: grid;
      gap: 7px;
      font-size: 13px;
      font-weight: 700;
    }

    .pathRow {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
    }

    input {
      min-width: 0;
      border: 1px solid #c8beac;
      border-radius: 12px;
      padding: 11px 12px;
      background: #fff;
      color: #211f1a;
      font: inherit;
    }

    button {
      border: 0;
      border-radius: 12px;
      padding: 11px 14px;
      background: #1d5f43;
      color: #fff;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }

    button.secondary {
      background: #31291f;
    }

    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .status {
      display: inline-flex;
      width: fit-content;
      border-radius: 999px;
      padding: 7px 11px;
      background: #dff2d8;
      color: #1d5f43;
      font-size: 13px;
      font-weight: 800;
    }

    #log {
      min-height: 150px;
      max-height: 260px;
      overflow: auto;
      white-space: pre-wrap;
      border-radius: 14px;
      padding: 14px;
      background: #211f1a;
      color: #f7eedc;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Figma Phaser Export Server</h1>
      <p class="status">Server running on http://localhost:${PORT}</p>
    </header>

    <section class="card grid">
      <label>
        Atlas output folder
        <div class="pathRow">
          <input id="atlasOutputDir" value="${escapeHtml(settings.atlasOutputDir)}" />
          <button id="chooseAtlas" type="button">Выбрать папку</button>
        </div>
      </label>

      <label>
        TypeScript output folder
        <div class="pathRow">
          <input id="tsOutputDir" value="${escapeHtml(settings.tsOutputDir)}" />
          <button id="chooseTs" type="button">Выбрать папку</button>
        </div>
      </label>

      <div>
        <button id="saveSettings" type="button" class="secondary">Сохранить</button>
        <button id="validateSettings" type="button">Проверить папки</button>
      </div>
    </section>

    <section class="card">
      <div id="log">Ready.</div>
    </section>
  </main>

  <script>
    const atlasInput = document.getElementById("atlasOutputDir");
    const tsInput = document.getElementById("tsOutputDir");
    const logNode = document.getElementById("log");

    function log(message) {
      const time = new Date().toLocaleTimeString();
      logNode.textContent += "\\n[" + time + "] " + message;
      logNode.scrollTop = logNode.scrollHeight;
    }

    async function requestJson(url, options) {
      const response = await fetch(url, options);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload && payload.error ? payload.error : text || "HTTP " + response.status);
      }
      return payload;
    }

    async function saveSettings() {
      const payload = await requestJson("/api/server/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atlasOutputDir: atlasInput.value,
          tsOutputDir: tsInput.value,
        }),
      });
      atlasInput.value = payload.settings.atlasOutputDir;
      tsInput.value = payload.settings.tsOutputDir;
      log("Settings saved.");
    }

    async function chooseDirectory(kind) {
      const payload = await requestJson("/api/server/choose-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      atlasInput.value = payload.settings.atlasOutputDir;
      tsInput.value = payload.settings.tsOutputDir;
      log((kind === "atlas" ? "Atlas" : "TS") + " folder: " + payload.directory);
    }

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
  </script>
</body>
</html>`;
}

function readSettings() {
    const defaults = {
        atlasOutputDir: ATLAS_OUTPUT_DIR,
        tsOutputDir: SCENE_OUTPUT_DIR,
    };

    try {
        if (!fs.existsSync(SETTINGS_FILE_PATH)) {
            return defaults;
        }

        const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, "utf8"));
        return normalizeSettings({
            ...defaults,
            ...(parsed && typeof parsed === "object" ? parsed : {}),
        });
    } catch (error) {
        return defaults;
    }
}

function writeSettings(settings) {
    const normalized = normalizeSettings({
        ...readSettings(),
        ...(settings && typeof settings === "object" ? settings : {}),
    });
    writeTextFile(SETTINGS_FILE_PATH, JSON.stringify(normalized, null, 2));
    return normalized;
}

function normalizeSettings(settings) {
    return {
        atlasOutputDir: normalizeOutputDirectory(settings.atlasOutputDir || ATLAS_OUTPUT_DIR),
        tsOutputDir: normalizeOutputDirectory(settings.tsOutputDir || SCENE_OUTPUT_DIR),
    };
}

function normalizeOutputDirectory(input) {
    const value = String(input || "").trim();
    if (!value) return "";
    return path.resolve(value);
}

function chooseDirectoryWithMacDialog(promptText) {
    return new Promise((resolve, reject) => {
        execFile("osascript", [
            "-e",
            `POSIX path of (choose folder with prompt ${JSON.stringify(promptText)})`,
        ], (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr.trim() || error.message));
                return;
            }

            resolve(normalizeOutputDirectory(stdout.trim()));
        });
    });
}

function validateDirectoryPath(directoryPath) {
    const normalized = normalizeOutputDirectory(directoryPath);

    if (!normalized) {
        return {
            ok: false,
            path: "",
            error: "Path is empty",
        };
    }

    try {
        ensureDirectoryExists(normalized);
        fs.accessSync(normalized, fs.constants.W_OK);
        return {
            ok: true,
            path: normalized,
        };
    } catch (error) {
        return {
            ok: false,
            path: normalized,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function sanitizePackName(input) {
    const value = String(input || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();

    return value || "pack";
}

function toCamelCase(input) {
    const safe = sanitizePackName(input);
    const tokens = safe
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((token) => token.toLowerCase());

    if (tokens.length === 0) return "asset";

    const [firstToken, ...restTokens] = tokens;
    const result =
        firstToken +
        restTokens
            .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
            .join("");

    return /^[0-9]/.test(result) ? `n${result}` : result;
}

function toPascalCase(input) {
    const camelCaseValue = toCamelCase(input);
    return camelCaseValue.charAt(0).toUpperCase() + camelCaseValue.slice(1);
}

function normalizeAtlasBasePath(input) {
    const raw = String(input || "").trim();
    let next = (raw || "./assets/atlases/").replace(/\\/g, "/");

    if (!next.startsWith("./") && !next.startsWith("../")) {
        if (next.startsWith("/")) {
            next = `.${next}`;
        } else {
            next = `./${next}`;
        }
    }

    if (!next.endsWith("/")) {
        next += "/";
    }

    return next;
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalSize = 0;

        request.on("data", (chunk) => {
            totalSize += chunk.length;

            if (totalSize > MAX_BODY_SIZE_BYTES) {
                reject(new Error(`Request body is too large: ${totalSize} bytes`));
                request.destroy();
                return;
            }

            chunks.push(chunk);
        });

        request.on("end", () => {
            try {
                const rawBody = Buffer.concat(chunks).toString("utf8");
                const parsed = JSON.parse(rawBody);
                resolve(parsed);
            } catch (error) {
                reject(error);
            }
        });

        request.on("error", (error) => {
            reject(error);
        });
    });
}

function validateExportPayload(payload) {
    if (!payload || typeof payload !== "object") {
        throw new Error("Payload must be an object");
    }

    if (!Array.isArray(payload.files) || payload.files.length === 0) {
        throw new Error('Payload must contain non-empty "files" array');
    }

    if (!payload.manifest || typeof payload.manifest !== "object") {
        throw new Error('Payload must contain "manifest" object');
    }

    if (!Array.isArray(payload.manifest.items)) {
        throw new Error('Payload.manifest must contain "items" array');
    }
}

function collectManifestItemsByFileName(manifest) {
    const result = new Map();

    for (const item of manifest.items) {
        if (!item || typeof item !== "object") continue;
        if (typeof item.fileName !== "string" || item.fileName.length === 0) continue;
        result.set(item.fileName, item);
    }

    return result;
}

function buildTexturePackerImages(files) {
    return files.map((file) => {
        if (!file || typeof file !== "object") {
            throw new Error("Invalid file entry");
        }

        if (typeof file.fileName !== "string" || file.fileName.length === 0) {
            throw new Error("File entry is missing fileName");
        }

        if (typeof file.bytesBase64 === "string" && file.bytesBase64.length > 0) {
            return {
                path: file.fileName,
                contents: Buffer.from(file.bytesBase64, "base64"),
            };
        }

        if (Array.isArray(file.bytes)) {
            return {
                path: file.fileName,
                contents: Buffer.from(file.bytes),
            };
        }

        throw new Error(`File "${file.fileName}" has invalid bytes`);
    });
}

function extractPackedFilesByName(packedFiles) {
    const result = new Map();

    for (const file of packedFiles) {
        result.set(file.name, file.buffer);
    }

    return result;
}

function createAssetsTs(packName, atlasBasePath, manifest) {
    const packCamelName = toCamelCase(packName);
    const packPascalName = toPascalCase(packName);
    const atlasPngPath = `${normalizeAtlasBasePath(atlasBasePath)}${packName}.png`;
    const atlasJsonPath = `${normalizeAtlasBasePath(atlasBasePath)}${packName}.json`;

    const itemsCode = manifest.items
        .map((item) => {
            const key = JSON.stringify(item.fileName);
            const itemName = JSON.stringify(item.name || item.fileName);
            const itemKind = JSON.stringify(item.kind || "image");
            const ninePadding =
                Number.isFinite(item.ninePadding) ? item.ninePadding : null;

            return `  ${key}: {
    key: ${key},
    name: ${itemName},
    atlasKey: ${JSON.stringify(packName)},
    frame: ${key},
    x: ${Math.round(item.x || 0)},
    y: ${Math.round(item.y || 0)},
    width: ${Math.round(item.width || 0)},
    height: ${Math.round(item.height || 0)},
    kind: ${itemKind},
    ninePadding: ${ninePadding === null ? "null" : ninePadding},
  }`;
        })
        .join(",\n");

    const orderCode = manifest.items
        .map((item) => `  ${JSON.stringify(item.fileName)}`)
        .join(",\n");

    return `/* eslint-disable */
export const ${packCamelName}AutoAssetsConfig = {
  images: [],
  preload: {
    atlases: [
      {
        key: ${JSON.stringify(packName)},
        pngUrl: ${JSON.stringify(atlasPngPath)},
        jsonUrl: ${JSON.stringify(atlasJsonPath)},
      },
    ],
  },
};

export function preload${packPascalName}Assets(scene) {
  scene.load.atlas(
    ${JSON.stringify(packName)},
    ${JSON.stringify(atlasPngPath)},
    ${JSON.stringify(atlasJsonPath)}
  );
}

export const ${packCamelName}AutoAssets = {
${itemsCode}
};

export const ${packCamelName}AutoAssetOrder = [
${orderCode}
];
`;
}

function createSceneTs(packName) {
    const packPascalName = toPascalCase(packName);
    const packFileName = sanitizePackName(packName);

    return `/* eslint-disable */
import Phaser from "phaser";
import { preload${packPascalName}Assets } from "./${packFileName}-assets";

export class ${packPascalName}AutoScene extends Phaser.Scene {
  constructor() {
    super(${JSON.stringify(`${packFileName}-auto-scene`)});
  }

  preload() {
    preload${packPascalName}Assets(this);
  }

  create() {
    this.add.text(20, 20, ${JSON.stringify(`${packPascalName}AutoScene loaded`)});
  }
}
`;
}

function createTypesTs() {
    return `/* eslint-disable */
export {};
`;
}

function createUtilsTs() {
    return `/* eslint-disable */
export function getFrameName(fileName) {
  return String(fileName || "");
}
`;
}

function rewriteAtlasJsonMetaImage(atlasJsonText, packName) {
    let atlasJson;

    try {
        atlasJson = JSON.parse(atlasJsonText);
    } catch (error) {
        throw new Error(`Failed to parse atlas json: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (atlasJson && atlasJson.meta && typeof atlasJson.meta === "object") {
        atlasJson.meta.image = `${packName}.png`;
    }

    return JSON.stringify(atlasJson, null, 2);
}

async function packAtlasWithFreeTexPacker(packName, images) {
    const options = {
        textureName: packName,
        width: 2048,
        height: 2048,
        fixedSize: false,
        powerOfTwo: false,
        padding: 2,
        extrude: 0,
        allowRotation: false,
        detectIdentical: true,
        allowTrim: false,
        removeFileExtension: false,
        prependFolderName: false,
        exporter: "Phaser3",
    };

    return packAsync(images, options);
}

async function handleExportRequest(request, response) {
    const payload = await readJsonBody(request);
    validateExportPayload(payload);
    const savedSettings = readSettings();
    const outputSettings = writeSettings({
        atlasOutputDir: payload.atlasOutputDir || savedSettings.atlasOutputDir,
        tsOutputDir: payload.tsOutputDir || savedSettings.tsOutputDir,
    });

    const packName = sanitizePackName(
        payload.packName ||
        payload.manifest.packName ||
        payload.manifest.root?.name ||
        "pack"
    );
    const atlasBasePath = normalizeAtlasBasePath(
        payload.atlasBasePath || "./assets/atlases/"
    );

    const manifestItemsByFileName = collectManifestItemsByFileName(payload.manifest);
    const texturePackerImages = buildTexturePackerImages(payload.files);
    const packedFiles = await packAtlasWithFreeTexPacker(packName, texturePackerImages);
    const packedFilesByName = extractPackedFilesByName(packedFiles);

    const atlasPngBuffer =
        packedFilesByName.get(`${packName}.png`) ||
        packedFilesByName.get(`${packName}-0.png`);

    const atlasJsonBuffer =
        packedFilesByName.get(`${packName}.json`) ||
        packedFilesByName.get(`${packName}-0.json`);

    if (!atlasPngBuffer) {
        throw new Error("Packed atlas png was not produced");
    }

    if (!atlasJsonBuffer) {
        throw new Error("Packed atlas json was not produced");
    }

    const atlasJsonText = rewriteAtlasJsonMetaImage(
        atlasJsonBuffer.toString("utf8"),
        packName
    );

    const normalizedManifest = {
        ...payload.manifest,
        packName,
        items: payload.manifest.items.map((item) => {
            const normalizedItem = manifestItemsByFileName.get(item.fileName) || item;
            return {
                ...normalizedItem,
                fileName: item.fileName,
            };
        }),
    };

    const assetsTsText = createAssetsTs(packName, atlasBasePath, normalizedManifest);
    const sceneTsText = createSceneTs(packName);
    const typesTsText = createTypesTs();
    const utilsTsText = createUtilsTs();

    const atlasPngFilePath = path.join(outputSettings.atlasOutputDir, `${packName}.png`);
    const atlasJsonFilePath = path.join(outputSettings.atlasOutputDir, `${packName}.json`);
    const assetsTsFilePath = path.join(outputSettings.tsOutputDir, `${packName}-assets.ts`);
    const sceneTsFilePath = path.join(outputSettings.tsOutputDir, `${packName}-scene.ts`);
    const typesTsFilePath = path.join(outputSettings.tsOutputDir, "types.ts");
    const utilsTsFilePath = path.join(outputSettings.tsOutputDir, "utils.ts");

    writeBinaryFile(atlasPngFilePath, atlasPngBuffer);
    writeTextFile(atlasJsonFilePath, atlasJsonText);
    writeTextFile(assetsTsFilePath, assetsTsText);
    writeTextFile(sceneTsFilePath, sceneTsText);
    writeTextFile(typesTsFilePath, typesTsText);
    writeTextFile(utilsTsFilePath, utilsTsText);

    sendJson(response, 200, {
        ok: true,
        message: "Export written to game folder",
        packName,
        atlasOutputDir: outputSettings.atlasOutputDir,
        tsOutputDir: outputSettings.tsOutputDir,
        filesWritten: [
            atlasPngFilePath,
            atlasJsonFilePath,
            assetsTsFilePath,
            sceneTsFilePath,
            typesTsFilePath,
            utilsTsFilePath,
        ],
    });
}

async function handleSettingsRequest(request, response) {
    if (request.method === "GET") {
        sendJson(response, 200, {
            ok: true,
            settings: readSettings(),
        });
        return;
    }

    if (request.method === "POST") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, {
            ok: true,
            settings: writeSettings(payload),
        });
        return;
    }

    sendJson(response, 405, {
        ok: false,
        error: `Method not allowed: ${request.method}`,
    });
}

async function handleChooseDirectoryRequest(request, response) {
    if (request.method !== "POST") {
        sendJson(response, 405, {
            ok: false,
            error: `Method not allowed: ${request.method}`,
        });
        return;
    }

    const payload = await readJsonBody(request);
    const kind = String(payload.kind || "").trim();

    if (kind !== "atlas" && kind !== "ts") {
        throw new Error('Directory kind must be "atlas" or "ts"');
    }

    const directory = await chooseDirectoryWithMacDialog(
        kind === "atlas" ? "Select atlas output folder" : "Select TypeScript output folder"
    );
    const settings = writeSettings({
        [kind === "atlas" ? "atlasOutputDir" : "tsOutputDir"]: directory,
    });

    sendJson(response, 200, {
        ok: true,
        kind,
        directory,
        settings,
    });
}

async function handleValidateSettingsRequest(request, response) {
    if (request.method !== "POST") {
        sendJson(response, 405, {
            ok: false,
            error: `Method not allowed: ${request.method}`,
        });
        return;
    }

    const payload = await readJsonBody(request);
    const settings = writeSettings(payload);
    const checks = {
        atlasOutputDir: validateDirectoryPath(settings.atlasOutputDir),
        tsOutputDir: validateDirectoryPath(settings.tsOutputDir),
    };
    const ok = checks.atlasOutputDir.ok && checks.tsOutputDir.ok;

    sendJson(response, ok ? 200 : 400, {
        ok,
        settings,
        checks,
    });
}

const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url || "/", `http://localhost:${PORT}`);

        if (request.method === "OPTIONS") {
            response.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            });
            response.end();
            return;
        }

        if (request.method === "GET" && url.pathname === "/") {
            sendHtml(response, 200, createSettingsPageHtml());
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/server/health") {
            const settings = readSettings();
            sendJson(response, 200, {
                ok: true,
                port: PORT,
                gameRootDir: GAME_ROOT_DIR,
                atlasOutputDir: settings.atlasOutputDir,
                tsOutputDir: settings.tsOutputDir,
            });
            return;
        }

        if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/server/settings") {
            await handleSettingsRequest(request, response);
            return;
        }

        if (url.pathname === "/api/server/choose-directory") {
            await handleChooseDirectoryRequest(request, response);
            return;
        }

        if (url.pathname === "/api/server/validate-settings") {
            await handleValidateSettingsRequest(request, response);
            return;
        }

        if (request.method === "POST" && url.pathname === "/api/figma/export") {
            await handleExportRequest(request, response);
            return;
        }

        sendJson(response, 404, {
            ok: false,
            error: `Route not found: ${request.method} ${url.pathname}`,
        });
    } catch (error) {
        sendJson(response, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
    }
});

server.listen(PORT, () => {
    const settings = readSettings();
    console.log("[figma2phaser] companion server started");
    console.log(`[figma2phaser] http://localhost:${PORT}/`);
    console.log(`[figma2phaser] http://localhost:${PORT}/api/server/health`);
    console.log(`[figma2phaser] GAME_ROOT_DIR=${GAME_ROOT_DIR}`);
    console.log(`[figma2phaser] ATLAS_OUTPUT_DIR=${settings.atlasOutputDir}`);
    console.log(`[figma2phaser] TS_OUTPUT_DIR=${settings.tsOutputDir}`);
});
