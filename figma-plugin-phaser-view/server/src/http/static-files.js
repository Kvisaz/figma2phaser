const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("../../configs/server-config");
const { sendContent, sendJson } = require("./http-response");

/**
 * ============================================================================
 * Static File Server
 * ============================================================================
 *
 * Serves the standalone browser settings interface from server/public.
 */

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
};

/**
 * Maps a request path to a safe file path inside server/public.
 */
function resolvePublicFilePath(urlPathname) {
    const relativePath = urlPathname === "/" ? "index.html" : urlPathname.replace(/^\/+/, "");
    const resolvedPath = path.resolve(PUBLIC_DIR, relativePath);

    if (!resolvedPath.startsWith(PUBLIC_DIR + path.sep) && resolvedPath !== PUBLIC_DIR) {
        return null;
    }

    return resolvedPath;
}

/**
 * Returns the response content type for a static file path.
 */
function getContentType(filePath) {
    return CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
}

/**
 * Handles GET requests for the browser settings interface.
 */
function handleStaticRequest(urlPathname, response) {
    const filePath = resolvePublicFilePath(urlPathname);

    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        sendJson(response, 404, {
            ok: false,
            error: `Static file not found: ${urlPathname}`,
        });
        return;
    }

    sendContent(response, 200, getContentType(filePath), fs.readFileSync(filePath));
}

module.exports = {
    resolvePublicFilePath,
    getContentType,
    handleStaticRequest,
};
