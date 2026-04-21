const path = require("path");

/**
 * ============================================================================
 * Naming and Path Normalization
 * ============================================================================
 *
 * Helpers used by atlas generation, TypeScript source generation, and settings.
 */

/**
 * Converts an output directory to an absolute filesystem path.
 */
function normalizeOutputDirectory(input) {
    const value = String(input || "").trim();
    if (!value) return "";
    return path.resolve(value);
}

/**
 * Converts arbitrary text into a safe pack/file base name.
 */
function sanitizePackName(input) {
    const value = String(input || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();

    return value || "pack";
}

/**
 * Converts a pack or frame name to a safe camelCase identifier.
 */
function toCamelCase(input) {
    const safe = sanitizePackName(input);
    const tokens = safe
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((token) => token.toLowerCase());

    if (tokens.length === 0) return "asset";

    const [firstToken, ...restTokens] = tokens;
    const result =
        firstToken +
        restTokens
            .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
            .join("");

    return /^[0-9]/.test(result) ? `n${result}` : result;
}

/**
 * Converts a pack or frame name to a safe PascalCase identifier.
 */
function toPascalCase(input) {
    const camelCaseValue = toCamelCase(input);
    return camelCaseValue.charAt(0).toUpperCase() + camelCaseValue.slice(1);
}

/**
 * Normalizes the runtime atlas URL base path used by generated Phaser preload code.
 */
function normalizeAtlasBasePath(input) {
    const raw = String(input || "").trim();
    let next = (raw || "./assets/atlases/").replace(/\\/g, "/");

    if (!next.startsWith("./") && !next.startsWith("../")) {
        if (next.startsWith("/")) {
            next = `.${next}`;
        } else {
            next = `./${next}`;
        }
    }

    if (!next.endsWith("/")) {
        next += "/";
    }

    return next;
}

module.exports = {
    normalizeOutputDirectory,
    sanitizePackName,
    toCamelCase,
    toPascalCase,
    normalizeAtlasBasePath,
};
