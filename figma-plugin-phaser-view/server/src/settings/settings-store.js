const fs = require("fs");
const { ATLAS_OUTPUT_DIR, SCENE_OUTPUT_DIR, SETTINGS_FILE_PATH } = require("../../configs/server-config");
const { writeTextFile, ensureDirectoryExists } = require("../filesystem/fs-utils");
const { normalizeOutputDirectory } = require("../utils/path-utils");

const EXPORT_MODE_ATLAS = "atlas";
const EXPORT_MODE_PNG = "png";

/**
 * ============================================================================
 * Persistent Settings
 * ============================================================================
 *
 * Settings are local machine state and are stored next to the server in
 * settings.local.json.
 */

/**
 * Applies defaults and normalization to settings.
 */
function normalizeExportMode(exportMode) {
    return exportMode === EXPORT_MODE_PNG ? EXPORT_MODE_PNG : EXPORT_MODE_ATLAS;
}

function normalizeSettings(settings) {
    return {
        atlasOutputDir: normalizeOutputDirectory(settings.atlasOutputDir || ATLAS_OUTPUT_DIR),
        tsOutputDir: normalizeOutputDirectory(settings.tsOutputDir || SCENE_OUTPUT_DIR),
        exportMode: normalizeExportMode(settings.exportMode),
    };
}

/**
 * Reads output path settings from disk and falls back to defaults.
 */
function readSettings() {
    const defaults = {
        atlasOutputDir: ATLAS_OUTPUT_DIR,
        tsOutputDir: SCENE_OUTPUT_DIR,
        exportMode: EXPORT_MODE_ATLAS,
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

module.exports = {
    EXPORT_MODE_ATLAS,
    EXPORT_MODE_PNG,
    normalizeExportMode,
    normalizeSettings,
    readSettings,
    writeSettings,
    validateDirectoryPath,
};
