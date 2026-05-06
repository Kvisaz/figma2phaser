const http = require("http");
const { GAME_ROOT_DIR, PORT } = require("../../configs/server-config");
const { sendJson, sendOptions } = require("./http-response");
const { readSettings } = require("../settings/settings-store");
const {
    handleChooseDirectoryRequest,
    handleSettingsRequest,
    handleValidateSettingsRequest,
} = require("../api/server-settings-handlers");
const { handleExportRequest } = require("../api/figma-export-handler");
const { handleStaticRequest } = require("./static-files");

/**
 * ============================================================================
 * HTTP Router
 * ============================================================================
 *
 * Public contract:
 * - GET  /                         browser settings page
 * - GET  /api/server/health        server diagnostics for plugin/page
 * - GET  /api/server/settings      read output paths
 * - POST /api/server/settings      save output paths
 * - POST /api/server/choose-directory
 * - POST /api/server/validate-settings
 * - POST /api/figma/export         Figma plugin export endpoint
 */

/**
 * Sends current server diagnostics and output settings.
 */
function handleHealthRequest(response) {
    const settings = readSettings();
    sendJson(response, 200, {
        ok: true,
        port: PORT,
        gameRootDir: GAME_ROOT_DIR,
        atlasOutputDir: settings.atlasOutputDir,
        tsOutputDir: settings.tsOutputDir,
        exportMode: settings.exportMode,
    });
}

/**
 * Dispatches API requests by pathname and method.
 */
async function routeApiRequest(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/server/health") {
        handleHealthRequest(response);
        return true;
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/server/settings") {
        await handleSettingsRequest(request, response);
        return true;
    }

    if (url.pathname === "/api/server/choose-directory") {
        await handleChooseDirectoryRequest(request, response);
        return true;
    }

    if (url.pathname === "/api/server/validate-settings") {
        await handleValidateSettingsRequest(request, response);
        return true;
    }

    if (request.method === "POST" && url.pathname === "/api/figma/export") {
        await handleExportRequest(request, response);
        return true;
    }

    return false;
}

/**
 * Handles one HTTP request and preserves the existing plugin-facing routes.
 */
async function handleRequest(request, response) {
    try {
        const url = new URL(request.url || "/", `http://localhost:${PORT}`);

        if (request.method === "OPTIONS") {
            sendOptions(response);
            return;
        }

        if (await routeApiRequest(request, response, url)) {
            return;
        }

        if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/settings-page.css" || url.pathname === "/settings-page.js")) {
            handleStaticRequest(url.pathname, response);
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
}

/**
 * Creates the HTTP server instance.
 */
function createServer() {
    return http.createServer(handleRequest);
}

module.exports = {
    handleHealthRequest,
    routeApiRequest,
    handleRequest,
    createServer,
};
