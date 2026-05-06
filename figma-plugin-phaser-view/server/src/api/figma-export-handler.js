const path = require("path");
const { sendJson } = require("../http/http-response");
const { copyDirectoryContents, writeBinaryFile, writeTextFile } = require("../filesystem/fs-utils");
const { readSettings } = require("../settings/settings-store");
const { readJsonBody } = require("../utils/request-body");
const { collectManifestItemsByFileName, validateExportPayload } = require("../export/export-payload");
const {
    buildTexturePackerImages,
    extractPackedFilesByName,
    packAtlasWithFreeTexPacker,
} = require("../export/texture-packer");
const { rewriteAtlasJsonMetaImage } = require("../export/atlas-json");
const { buildPhaserSceneSources } = require("../export/phaser-source-generator");
const { normalizeAtlasBasePath, sanitizePackName } = require("../utils/path-utils");

const EXPORT_ASSETS_SOURCE_DIR = path.join(__dirname, "../export-assets");

/**
 * ============================================================================
 * Figma Export API
 * ============================================================================
 *
 * Receives exported PNG data from the Figma plugin and writes atlas plus Phaser
 * TypeScript files to the configured game project folders.
 */

/**
 * Merges original manifest metadata with normalized file names.
 */
function buildNormalizedManifest(payload, packName, manifestItemsByFileName) {
    return {
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
}

/**
 * Resolves output file paths for atlas and TypeScript files.
 */
function buildOutputFilePaths(outputSettings, packName) {
    const tsPackOutputDir = path.join(outputSettings.tsOutputDir, packName);

    return {
        atlasPngFilePath: path.join(outputSettings.atlasOutputDir, `${packName}.png`),
        atlasJsonFilePath: path.join(outputSettings.atlasOutputDir, `${packName}.json`),
        assetsTsFilePath: path.join(tsPackOutputDir, "assets.ts"),
        viewsIndexTsFilePath: path.join(tsPackOutputDir, "views", "index.ts"),
        exportAssetsTargetDir: tsPackOutputDir,
        tsOutputDir: tsPackOutputDir,
    };
}

/**
 * Extracts required atlas buffers from free-tex-packer output.
 */
function getPackedAtlasBuffers(packedFilesByName, packName) {
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

    return {
        atlasPngBuffer,
        atlasJsonBuffer,
    };
}

/**
 * Writes packed atlas and generated TypeScript source files.
 */
function writeExportFiles(filePaths, atlasPngBuffer, atlasJsonText, sceneSources) {
    writeBinaryFile(filePaths.atlasPngFilePath, atlasPngBuffer);
    writeTextFile(filePaths.atlasJsonFilePath, atlasJsonText);
    writeTextFile(filePaths.assetsTsFilePath, sceneSources.assetsTs);
    writeTextFile(filePaths.viewsIndexTsFilePath, sceneSources.viewIndexTs || sceneSources.viewTs);
    (Array.isArray(sceneSources.viewFiles) ? sceneSources.viewFiles : []).forEach((file) => {
        writeTextFile(path.join(filePaths.tsOutputDir, file.relativePath), file.code);
    });
    copyDirectoryContents(EXPORT_ASSETS_SOURCE_DIR, filePaths.exportAssetsTargetDir);
}

/**
 * Handles POST /api/figma/export and writes generated atlas/TS files to disk.
 */
async function handleExportRequest(request, response) {
    const payload = await readJsonBody(request);
    validateExportPayload(payload);

    const outputSettings = readSettings();
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
    const { atlasPngBuffer, atlasJsonBuffer } = getPackedAtlasBuffers(packedFilesByName, packName);
    const atlasJsonText = rewriteAtlasJsonMetaImage(
        atlasJsonBuffer.toString("utf8"),
        packName
    );
    const normalizedManifest = buildNormalizedManifest(payload, packName, manifestItemsByFileName);
    const sceneSources = buildPhaserSceneSources({
        packName,
        manifest: normalizedManifest,
        atlasBasePath,
    });
    const filePaths = buildOutputFilePaths(outputSettings, packName);

    writeExportFiles(filePaths, atlasPngBuffer, atlasJsonText, sceneSources);

    const filesWritten = [
        filePaths.atlasPngFilePath,
        filePaths.atlasJsonFilePath,
        filePaths.assetsTsFilePath,
        filePaths.viewsIndexTsFilePath,
    ];

    (Array.isArray(sceneSources.viewFiles) ? sceneSources.viewFiles : []).forEach((file) => {
        filesWritten.push(path.join(filePaths.tsOutputDir, file.relativePath));
    });

    sendJson(response, 200, {
        ok: true,
        message: "Export written to game folder",
        packName,
        atlasOutputDir: outputSettings.atlasOutputDir,
        tsOutputDir: filePaths.tsOutputDir,
        filesWritten,
    });
}

module.exports = {
    buildNormalizedManifest,
    buildOutputFilePaths,
    getPackedAtlasBuffers,
    writeExportFiles,
    handleExportRequest,
};
