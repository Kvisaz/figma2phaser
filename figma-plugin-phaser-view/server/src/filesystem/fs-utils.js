const fs = require("fs");
const path = require("path");

/**
 * ============================================================================
 * Filesystem Helpers
 * ============================================================================
 *
 * Shared low-level helpers for creating directories and writing generated
 * output files.
 */

/**
 * Creates a directory recursively if it does not exist.
 */
function ensureDirectoryExists(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}

/**
 * Writes UTF-8 text and creates the parent directory first.
 */
function writeTextFile(filePath, content) {
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf8");
}

/**
 * Writes binary data and creates the parent directory first.
 */
function writeBinaryFile(filePath, buffer) {
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, buffer);
}

module.exports = {
    ensureDirectoryExists,
    writeTextFile,
    writeBinaryFile,
};
