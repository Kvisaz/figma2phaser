const path = require("path");

/**
 * ============================================================================
 * Static Configuration
 * ============================================================================
 *
 * Runtime paths can be overridden from the server settings page. These values
 * are only defaults and stable process-level constants.
 */

const PORT = 3456;
const GAME_ROOT_DIR = "/Users/sergeytokarev/work_my/YOUR_GAME_PROJECT";
const ATLAS_OUTPUT_DIR = path.join(GAME_ROOT_DIR, "public", "assets", "atlases");
const SCENE_OUTPUT_DIR = path.join(GAME_ROOT_DIR, "src", "autogen");
const SETTINGS_FILE_PATH = path.join(__dirname, "..", "settings.local.json");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MAX_BODY_SIZE_BYTES = 200 * 1024 * 1024;

module.exports = {
    PORT,
    GAME_ROOT_DIR,
    ATLAS_OUTPUT_DIR,
    SCENE_OUTPUT_DIR,
    SETTINGS_FILE_PATH,
    PUBLIC_DIR,
    MAX_BODY_SIZE_BYTES,
};
