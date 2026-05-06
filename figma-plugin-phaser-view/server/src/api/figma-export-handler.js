const path = require("path");
const { sendJson } = require("../http/http-response");
const { copyDirectoryContents, writeBinaryFile, writeTextFile } = require("../filesystem/fs-utils");
const { EXPORT_MODE_PNG, readSettings } = require("../settings/settings-store");
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
 * Receives exported PNG data from the Figma plugin and writes atlas/PNG assets
 * plus Phaser TypeScript files to the configured game project folders.
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
    const pngOutputDir = path.join(outputSettings.atlasOutputDir, "png");

    return {
        exportMode: outputSettings.exportMode,
        atlasPngFilePath: path.join(outputSettings.atlasOutputDir, `${packName}.png`),
        atlasJsonFilePath: path.join(outputSettings.atlasOutputDir, `${packName}.json`),
        pngOutputDir,
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
 * Writes separate PNG files and returns written paths.
 */
function writePngFiles(pngOutputDir, images) {
    return images.map((image) => {
        const filePath = path.join(pngOutputDir, path.basename(image.path));
        writeBinaryFile(filePath, image.contents);
        return filePath;
    });
}

/**
 * Writes atlas/PNG assets and generated TypeScript source files.
 */
function writeExportFiles(filePaths, atlasPngBuffer, atlasJsonText, sceneSources, pngImages = []) {
    const filesWritten = [];

    if (filePaths.exportMode === EXPORT_MODE_PNG) {
        filesWritten.push(...writePngFiles(filePaths.pngOutputDir, pngImages));
    } else {
        writeBinaryFile(filePaths.atlasPngFilePath, atlasPngBuffer);
        writeTextFile(filePaths.atlasJsonFilePath, atlasJsonText);
        filesWritten.push(filePaths.atlasPngFilePath, filePaths.atlasJsonFilePath);
    }

    writeTextFile(filePaths.assetsTsFilePath, sceneSources.assetsTs);
    writeTextFile(filePaths.viewsIndexTsFilePath, sceneSources.viewIndexTs || sceneSources.viewTs);
    filesWritten.push(filePaths.assetsTsFilePath, filePaths.viewsIndexTsFilePath);

    (Array.isArray(sceneSources.viewFiles) ? sceneSources.viewFiles : []).forEach((file) => {
        const filePath = path.join(filePaths.tsOutputDir, file.relativePath);
        writeTextFile(filePath, file.code);
        filesWritten.push(filePath);
    });

    copyDirectoryContents(EXPORT_ASSETS_SOURCE_DIR, filePaths.exportAssetsTargetDir);
    return filesWritten;
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
    const normalizedManifest = buildNormalizedManifest(payload, packName, manifestItemsByFileName);
    const texturePackerImages = buildTexturePackerImages(payload.files);
    const filePaths = buildOutputFilePaths(outputSettings, packName);
    let atlasPngBuffer = null;
    let atlasJsonText = null;

    if (outputSettings.exportMode !== EXPORT_MODE_PNG) {
        const packedFiles = await packAtlasWithFreeTexPacker(packName, texturePackerImages);
        const packedFilesByName = extractPackedFilesByName(packedFiles);
        const packedAtlas = getPackedAtlasBuffers(packedFilesByName, packName);
        atlasPngBuffer = packedAtlas.atlasPngBuffer;
        atlasJsonText = rewriteAtlasJsonMetaImage(
            packedAtlas.atlasJsonBuffer.toString("utf8"),
            packName
        );
    }

    const sceneSources = buildPhaserSceneSources({
        packName,
        manifest: normalizedManifest,
        atlasBasePath,
        exportMode: outputSettings.exportMode,
    });
    const filesWritten = writeExportFiles(filePaths, atlasPngBuffer, atlasJsonText, sceneSources, texturePackerImages);

    sendJson(response, 200, {
        ok: true,
        message: "Export written to game folder",
        packName,
        exportMode: outputSettings.exportMode,
        atlasOutputDir: outputSettings.atlasOutputDir,
        pngOutputDir: filePaths.pngOutputDir,
        tsOutputDir: filePaths.tsOutputDir,
        filesWritten,
    });
}

module.exports = {
    buildNormalizedManifest,
    buildOutputFilePaths,
    getPackedAtlasBuffers,
    writePngFiles,
    writeExportFiles,
    handleExportRequest,
};
