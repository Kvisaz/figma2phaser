/**
 * ============================================================================
 * HTTP Response Helpers
 * ============================================================================
 *
 * Keeps response headers consistent across API and static routes.
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
 * Sends text or binary content with the provided content type.
 */
function sendContent(response, statusCode, contentType, content) {
    response.writeHead(statusCode, {
        "Content-Type": contentType,
    });
    response.end(content);
}

/**
 * Sends the shared CORS preflight response.
 */
function sendOptions(response) {
    response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
}

module.exports = {
    sendJson,
    sendContent,
    sendOptions,
};
