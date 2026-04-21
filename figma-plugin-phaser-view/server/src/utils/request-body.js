const { MAX_BODY_SIZE_BYTES } = require("../../configs/server-config");

/**
 * ============================================================================
 * Request Parsing
 * ============================================================================
 *
 * JSON body parsing is centralized so all API handlers share the same size
 * limit and error behavior.
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

module.exports = {
    readJsonBody,
};
