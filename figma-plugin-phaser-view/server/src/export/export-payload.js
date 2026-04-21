/**
 * ============================================================================
 * Export Payload Validation
 * ============================================================================
 *
 * Validates and indexes the Figma plugin payload before atlas packing.
 */

/**
 * Validates the minimum shape required for a Figma export payload.
 */
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

/**
 * Indexes manifest items by generated PNG file name.
 */
function collectManifestItemsByFileName(manifest) {
    const result = new Map();

    for (const item of manifest.items) {
        if (!item || typeof item !== "object") continue;
        if (typeof item.fileName !== "string" || item.fileName.length === 0) continue;
        result.set(item.fileName, item);
    }

    return result;
}

module.exports = {
    validateExportPayload,
    collectManifestItemsByFileName,
};
