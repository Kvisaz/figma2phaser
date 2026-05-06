const { GAME_ROOT_DIR, PORT } = require("./configs/server-config");
const { createServer } = require("./src/http/router");
const { readSettings } = require("./src/settings/settings-store");

/**
 * ============================================================================
 * Server Entrypoint
 * ============================================================================
 *
 * Keeps startup separate from routing and business logic. Plugin-facing routes
 * are implemented in src/http/router.js and remain unchanged.
 */

const server = createServer();

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
    console.log(`[figma2phaser] EXPORT_MODE=${settings.exportMode}`);
});
