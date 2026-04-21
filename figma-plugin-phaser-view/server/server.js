const http = require("http");
const fs = require("fs");
const path = require("path");
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

const server = http.createServer(async (request, response) => {
    try {
        if (request.method === "OPTIONS") {
            response.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            });
            response.end();
            return;
        }

        if (request.method === "GET" && request.url === "/health") {
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

        if ((request.method === "GET" || request.method === "POST") && request.url === "/settings") {
            await handleSettingsRequest(request, response);
            return;
        }

        if (request.method === "POST" && request.url === "/export") {
            await handleExportRequest(request, response);
            return;
        }

        sendJson(response, 404, {
            ok: false,
            error: `Route not found: ${request.method} ${request.url}`,
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
    console.log(`[figma2phaser] http://localhost:${PORT}/health`);
    console.log(`[figma2phaser] GAME_ROOT_DIR=${GAME_ROOT_DIR}`);
    console.log(`[figma2phaser] ATLAS_OUTPUT_DIR=${settings.atlasOutputDir}`);
    console.log(`[figma2phaser] TS_OUTPUT_DIR=${settings.tsOutputDir}`);
});
