const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { packAsync } = require("free-tex-packer-core");

const PORT = 3456;
const SETTINGS_FILE_PATH = path.join(__dirname, "settings.local.json");

/**
 * ============================================================================
 * Static Configuration
 * ============================================================================
 *
 * Constants below define fallback paths and request limits. Runtime output paths
 * can still be overridden from the server settings page.
 */

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

/**
 * ============================================================================
 * HTTP Response Helpers
 * ============================================================================
 *
 * Small helpers for sending JSON and HTML responses with consistent headers.
 */

/**
 * Sends a JSON response with CORS headers for Figma plugin requests.
 */
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

/**
 * Sends an HTML response for the server settings page.
 */
function sendHtml(response, statusCode, html) {
    response.writeHead(statusCode, {
        "Content-Type": "text/html; charset=utf-8",
    });
    response.end(html);
}

/**
 * ============================================================================
 * Filesystem Helpers
 * ============================================================================
 *
 * Helpers for creating directories and writing generated output files.
 */

/**
 * Creates a directory recursively if it does not exist.
 */
function ensureDirectoryExists(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}

/**
 * Writes UTF-8 text and creates the parent directory first.
 */
function writeTextFile(filePath, content) {
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf8");
}

/**
 * Writes binary data and creates the parent directory first.
 */
function writeBinaryFile(filePath, buffer) {
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, buffer);
}

/**
 * ============================================================================
 * Settings Page HTML
 * ============================================================================
 *
 * The server root route renders this standalone settings page. It lets the user
 * configure local output directories outside the Figma plugin sandbox.
 */

/**
 * Escapes text before inserting settings values into the HTML page.
 */
function escapeHtml(input) {
    return String(input || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Builds the standalone settings page served from GET /.
 */
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

    /**
     * Appends a timestamped message to the page log.
     */
    function log(message) {
      const time = new Date().toLocaleTimeString();
      logNode.textContent += "\\n[" + time + "] " + message;
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
     * Saves manually edited output paths to the server settings file.
     */
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

    /**
     * Opens the native folder picker through the server API.
     */
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
  </script>
</body>
</html>`;
}

/**
 * ============================================================================
 * Persistent Settings
 * ============================================================================
 *
 * Settings are stored next to the server in settings.local.json. They are local
 * machine state and should not be committed.
 */

/**
 * Reads output path settings from disk and falls back to defaults.
 */
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

/**
 * Normalizes and writes output path settings to disk.
 */
function writeSettings(settings) {
    const normalized = normalizeSettings({
        ...readSettings(),
        ...(settings && typeof settings === "object" ? settings : {}),
    });
    writeTextFile(SETTINGS_FILE_PATH, JSON.stringify(normalized, null, 2));
    return normalized;
}

/**
 * Applies defaults and absolute-path normalization to settings.
 */
function normalizeSettings(settings) {
    return {
        atlasOutputDir: normalizeOutputDirectory(settings.atlasOutputDir || ATLAS_OUTPUT_DIR),
        tsOutputDir: normalizeOutputDirectory(settings.tsOutputDir || SCENE_OUTPUT_DIR),
    };
}

/**
 * Converts an output directory to an absolute filesystem path.
 */
function normalizeOutputDirectory(input) {
    const value = String(input || "").trim();
    if (!value) return "";
    return path.resolve(value);
}

/**
 * Opens the macOS native folder picker and resolves the selected path.
 */
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

/**
 * Verifies that a directory exists or can be created and is writable.
 */
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

/**
 * ============================================================================
 * Naming and Path Normalization
 * ============================================================================
 *
 * Helpers used by atlas generation and TypeScript source generation.
 */

/**
 * Converts arbitrary text into a safe pack/file base name.
 */
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

/**
 * Converts a pack or frame name to a safe camelCase identifier.
 */
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

/**
 * Converts a pack or frame name to a safe PascalCase identifier.
 */
function toPascalCase(input) {
    const camelCaseValue = toCamelCase(input);
    return camelCaseValue.charAt(0).toUpperCase() + camelCaseValue.slice(1);
}

/**
 * Normalizes the runtime atlas URL base path used by generated Phaser preload code.
 */
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

/**
 * ============================================================================
 * Request Parsing and Payload Validation
 * ============================================================================
 *
 * Helpers for API handlers that read and validate JSON payloads.
 */

/**
 * Reads and parses a JSON body with a hard size limit.
 */
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

/**
 * Validates the minimum shape required for a Figma export payload.
 */
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

/**
 * Indexes manifest items by generated PNG file name.
 */
function collectManifestItemsByFileName(manifest) {
    const result = new Map();

    for (const item of manifest.items) {
        if (!item || typeof item !== "object") continue;
        if (typeof item.fileName !== "string" || item.fileName.length === 0) continue;
        result.set(item.fileName, item);
    }

    return result;
}

/**
 * ============================================================================
 * Texture Packer Input/Output Helpers
 * ============================================================================
 *
 * Converts Figma-exported PNG payloads into free-tex-packer input and indexes
 * its generated output files.
 */

/**
 * Converts encoded PNG entries into free-tex-packer image descriptors.
 */
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

/**
 * Indexes packed atlas output buffers by output file name.
 */
function extractPackedFilesByName(packedFiles) {
    const result = new Map();

    for (const file of packedFiles) {
        result.set(file.name, file.buffer);
    }

    return result;
}

/**
 * ============================================================================
 * Phaser TypeScript Source Generation
 * ============================================================================
 *
 * Restores the old generated runtime layer: typed asset metadata, helpers for
 * placing image/nine-slice objects, asset registry, and preview scene.
 */

/**
 * Builds a runtime atlas file URL from a normalized base path and file name.
 */
function buildAtlasFilePath(basePath, fileName) {
    const cleanFileName = String(fileName || "").replace(/^\/+/, "");
    return `${normalizeAtlasBasePath(basePath)}${cleanFileName}`;
}

/**
 * Creates a unique safe asset key for generated TypeScript object properties.
 */
function createUniqueAssetKey(rawName, used) {
    const base = toCamelCase(rawName);
    let next = base || "asset";
    let suffix = 2;

    while (used.has(next)) {
        next = `${base}${suffix}`;
        suffix += 1;
    }

    used.add(next);
    return next;
}

/**
 * Extracts nine-slice padding from names like "button.nine.20".
 */
function detectNinePadding(rawName) {
    const match = String(rawName || "").trim().match(/(?:^|[._-])nine\.(\d+)$/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
}

/**
 * Generates types.ts, utils.ts, [pack]-assets.ts, and [pack]-scene.ts.
 */
function buildPhaserSceneSources(props) {
    const { packName, manifest, atlasBasePath } = props;
    const packCamel = toCamelCase(packName);
    const packPascal = toPascalCase(packName);
    const packFileName = sanitizePackName(packName);
    const sceneClassName = `${packPascal}Scene`;
    const sceneKey = sceneClassName;
    const preloadFunctionName = `preload${packPascal}Assets`;
    const atlasPngUrl = buildAtlasFilePath(atlasBasePath, `${packName}.png`);
    const atlasJsonUrl = buildAtlasFilePath(atlasBasePath, `${packName}.json`);
    const usedAssetKeys = new Set();
    const entries = manifest.items.map((item) => {
        const frameBaseName = String(item.fileName || "item.png").replace(/\.png$/i, "");
        const assetKey = createUniqueAssetKey(frameBaseName, usedAssetKeys);
        const kind = item.kind === "nine" ? "nine" : "image";
        const ninePadding = kind === "nine"
            ? (Number.isFinite(Number(item.ninePadding)) ? Number(item.ninePadding) : detectNinePadding(item.name || "") || 20)
            : undefined;

        return {
            assetKey,
            kind,
            ninePadding,
            x: Number(item.x || 0),
            y: Number(item.y || 0),
            width: Number(item.width || 0),
            height: Number(item.height || 0),
            frameName: item.fileName,
        };
    });

    entries.sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        if (a.x !== b.x) return a.x - b.x;
        return a.assetKey.localeCompare(b.assetKey);
    });

    const typesTs = `// This file is auto-generated by figma2assets plugin. Do not edit manually.
export type AutoAssetKind = "image" | "nine";

export interface IAutoAssetData {
  readonly name: string;
  readonly url: string;
  readonly frameName: string;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly kind: AutoAssetKind;
  readonly ninePadding?: number;
}

export type AutoAssetMap = Record<string, IAutoAssetData>;

export interface IAutoAtlasConfig {
  readonly name: string;
  readonly pngUrl: string;
  readonly jsonUrl: string;
}

export interface IAutoAssetsConfig {
  readonly images: AutoAssetMap;
  readonly preload: {
    readonly atlases: readonly IAutoAtlasConfig[];
  };
}

export interface IAddAssetImageProps {
  scene: Phaser.Scene;
  asset: IAutoAssetData;
  x?: number;
  y?: number;
}

export interface IAddAssetNineProps {
  scene: Phaser.Scene;
  asset: IAutoAssetData;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}
`;

    const utilsTs = `// This file is auto-generated by figma2assets plugin. Do not edit manually.
import { IAddAssetImageProps, IAddAssetNineProps } from "./types";

/**
 * Positions a Phaser object by its left-top corner.
 */
function setLeftTop<T extends Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Origin>(
  obj: T,
  x: number,
  y: number,
): T {
  obj.setPosition(x, y).setOrigin(0);
  return obj;
}

/**
 * Adds an atlas image and positions it by Figma coordinates.
 */
export function addAssetImage(props: IAddAssetImageProps): Phaser.GameObjects.Image {
  const { scene, asset, x, y } = props;
  const targetX = x ?? asset.x;
  const targetY = y ?? asset.y;
  const imageNode = scene.add.image(0, 0, asset.url, asset.frameName);
  return setLeftTop(imageNode, targetX, targetY);
}

/**
 * Adds a nine-slice object and positions it by Figma coordinates.
 */
export function addAssetNine(props: IAddAssetNineProps): Phaser.GameObjects.NineSlice {
  const { scene, asset, width, height, x, y } = props;
  const padding = asset.ninePadding ?? 20;
  const targetWidth = width ?? asset.width;
  const targetHeight = height ?? asset.height;
  const targetX = x ?? asset.x;
  const targetY = y ?? asset.y;

  const nineSliceNode = scene.add.existing(
    new Phaser.GameObjects.NineSlice(
      scene,
      0,
      0,
      asset.url,
      asset.frameName,
      targetWidth,
      targetHeight,
      padding,
      padding,
      padding,
      padding,
    ),
  );

  return setLeftTop(nineSliceNode, targetX, targetY);
}
`;

    const assetsObjectLines = entries.map((entry) => {
        const ninePaddingLine = entry.kind === "nine" ? `\n    ninePadding: ${entry.ninePadding},` : "";
        return `  ${entry.assetKey}: {\n    name: "${entry.assetKey}",\n    url: "${atlasPngUrl}",\n    frameName: "${entry.frameName}",\n    width: ${entry.width},\n    height: ${entry.height},\n    x: ${entry.x},\n    y: ${entry.y},\n    kind: "${entry.kind}",${ninePaddingLine}\n  },`;
    });
    const orderLines = entries.map((entry) => `  "${entry.assetKey}",`);

    const assetsTs = `// This file is auto-generated by figma2assets plugin. Do not edit manually.
import { AutoAssetMap, IAutoAssetsConfig } from "./types";

export const ${packCamel}AutoAssetsConst = {
${assetsObjectLines.join("\n")}
} as const;

export type AutoAssetName = keyof typeof ${packCamel}AutoAssetsConst;

export const ${packCamel}AutoAssetOrder: readonly AutoAssetName[] = [
${orderLines.join("\n")}
];

export const ${packCamel}AutoAssetsConfig: IAutoAssetsConfig = {
  images: ${packCamel}AutoAssetsConst,
  preload: {
    atlases: [
      {
        name: "${packName}",
        pngUrl: "${atlasPngUrl}",
        jsonUrl: "${atlasJsonUrl}",
      },
    ],
  },
} as const;

export const ${packCamel}AutoAssets: AutoAssetMap = ${packCamel}AutoAssetsConfig.images;
export const ${packCamel}AutoAtlas = ${packCamel}AutoAssetsConfig.preload.atlases[0];

/**
 * Preloads the generated atlas for this pack.
 */
export function ${preloadFunctionName}(scene: Phaser.Scene): void {
  ${packCamel}AutoAssetsConfig.preload.atlases.forEach((atlas) => {
    if (scene.textures.exists(atlas.pngUrl)) return;
    scene.load.atlas(atlas.pngUrl, atlas.pngUrl, atlas.jsonUrl);
  });
}
`;

    const sceneTs = `// This file is auto-generated by figma2assets plugin. Do not edit manually.
import { addAssetImage, addAssetNine } from "./utils";
import { ${packCamel}AutoAssets, ${packCamel}AutoAssetOrder, AutoAssetName, ${preloadFunctionName} } from "./${packFileName}-assets";

export class ${sceneClassName} extends Phaser.Scene {
  constructor() {
    super({ key: "${sceneKey}" });
  }

  preload(): void {
    ${preloadFunctionName}(this);
  }

  create(): void {
    ${packCamel}AutoAssetOrder.forEach((assetName: AutoAssetName) => {
      const asset = ${packCamel}AutoAssets[assetName];
      if (asset.kind === "nine") {
        addAssetNine({ scene: this, asset });
        return;
      }
      addAssetImage({ scene: this, asset });
    });
  }
}
`;

    return {
        typesTs,
        utilsTs,
        assetsTs,
        sceneTs,
    };
}

/**
 * ============================================================================
 * Atlas JSON and Packing
 * ============================================================================
 *
 * Runs free-tex-packer and normalizes its Phaser atlas JSON output.
 */

/**
 * Rewrites atlas JSON metadata so meta.image points to the generated PNG name.
 */
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

/**
 * Packs exported PNG files into a Phaser 3 atlas with free-tex-packer.
 */
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

/**
 * ============================================================================
 * API Route Handlers
 * ============================================================================
 *
 * Handlers below implement Figma export, server settings, folder picking, and
 * settings validation endpoints.
 */

/**
 * Handles POST /api/figma/export and writes generated atlas/TS files to disk.
 */
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

    const sceneSources = buildPhaserSceneSources({
        packName,
        manifest: normalizedManifest,
        atlasBasePath,
    });
    const assetsTsText = sceneSources.assetsTs;
    const sceneTsText = sceneSources.sceneTs;
    const typesTsText = sceneSources.typesTs;
    const utilsTsText = sceneSources.utilsTs;

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

/**
 * Handles GET/POST /api/server/settings.
 */
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

/**
 * Handles POST /api/server/choose-directory through the native folder picker.
 */
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

/**
 * Handles POST /api/server/validate-settings and checks output directories.
 */
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

/**
 * ============================================================================
 * HTTP Router and Server Startup
 * ============================================================================
 *
 * The router serves the settings page, server-management API, and Figma export
 * API from one localhost process.
 */

/**
 * Dispatches incoming HTTP requests to page, server API, or Figma API handlers.
 */
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

/**
 * Starts the companion server and prints the current settings summary.
 */
server.listen(PORT, () => {
    const settings = readSettings();
    console.log("[figma2phaser] companion server started");
    console.log(`[figma2phaser] http://localhost:${PORT}/`);
    console.log(`[figma2phaser] http://localhost:${PORT}/api/server/health`);
    console.log(`[figma2phaser] GAME_ROOT_DIR=${GAME_ROOT_DIR}`);
    console.log(`[figma2phaser] ATLAS_OUTPUT_DIR=${settings.atlasOutputDir}`);
    console.log(`[figma2phaser] TS_OUTPUT_DIR=${settings.tsOutputDir}`);
});
