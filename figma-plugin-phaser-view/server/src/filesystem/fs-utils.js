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

/**
 * Copies all files and folders from a source directory into a destination directory.
 */
function copyDirectoryContents(sourceDir, targetDir) {
    ensureDirectoryExists(targetDir);

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
            copyDirectoryContents(sourcePath, targetPath);
            continue;
        }

        if (entry.isSymbolicLink()) {
            const linkTarget = fs.readlinkSync(sourcePath);
            try {
                fs.symlinkSync(linkTarget, targetPath);
            } catch (error) {
                if (error && error.code === "EEXIST") {
                    fs.rmSync(targetPath, { force: true, recursive: true });
                    fs.symlinkSync(linkTarget, targetPath);
                    continue;
                }
                throw error;
            }
            continue;
        }

        fs.copyFileSync(sourcePath, targetPath);
    }
}

module.exports = {
    ensureDirectoryExists,
    writeTextFile,
    writeBinaryFile,
    copyDirectoryContents,
};
