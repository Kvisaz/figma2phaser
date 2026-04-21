const { execFile } = require("child_process");
const { normalizeOutputDirectory } = require("../utils/path-utils");

/**
 * ============================================================================
 * Native Folder Picker
 * ============================================================================
 *
 * Browser pages cannot access arbitrary filesystem paths directly, so macOS
 * folder selection is delegated to the local server process.
 */

/**
 * Opens the macOS native folder picker and resolves the selected path.
 */
function chooseDirectoryWithMacDialog(promptText) {
    return new Promise((resolve, reject) => {
        execFile("osascript", [
            "-e",
            `POSIX path of (choose folder with prompt ${JSON.stringify(promptText)})`,
        ], (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr.trim() || error.message));
                return;
            }

            resolve(normalizeOutputDirectory(stdout.trim()));
        });
    });
}

module.exports = {
    chooseDirectoryWithMacDialog,
};
