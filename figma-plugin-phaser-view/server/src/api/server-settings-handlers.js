const { sendJson } = require("../http/http-response");
const { readSettings, validateDirectoryPath, writeSettings } = require("../settings/settings-store");
const { chooseDirectoryWithMacDialog } = require("../settings/native-folder-picker");
const { readJsonBody } = require("../utils/request-body");

/**
 * ============================================================================
 * Server Settings API
 * ============================================================================
 *
 * Handles local settings, native folder picking, and output folder validation.
 */

/**
 * Handles GET/POST /api/server/settings.
 */
async function handleSettingsRequest(request, response) {
    if (request.method === "GET") {
        sendJson(response, 200, {
            ok: true,
            settings: readSettings(),
        });
        return;
    }

    if (request.method === "POST") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, {
            ok: true,
            settings: writeSettings(payload),
        });
        return;
    }

    sendJson(response, 405, {
        ok: false,
        error: `Method not allowed: ${request.method}`,
    });
}

/**
 * Handles POST /api/server/choose-directory through the native folder picker.
 */
async function handleChooseDirectoryRequest(request, response) {
    if (request.method !== "POST") {
        sendJson(response, 405, {
            ok: false,
            error: `Method not allowed: ${request.method}`,
        });
        return;
    }

    const payload = await readJsonBody(request);
    const kind = String(payload.kind || "").trim();

    if (kind !== "atlas" && kind !== "ts") {
        throw new Error('Directory kind must be "atlas" or "ts"');
    }

    const directory = await chooseDirectoryWithMacDialog(
        kind === "atlas" ? "Select atlas output folder" : "Select TypeScript output folder"
    );
    const settings = writeSettings({
        [kind === "atlas" ? "atlasOutputDir" : "tsOutputDir"]: directory,
    });

    sendJson(response, 200, {
        ok: true,
        kind,
        directory,
        settings,
    });
}

/**
 * Handles POST /api/server/validate-settings and checks output directories.
 */
async function handleValidateSettingsRequest(request, response) {
    if (request.method !== "POST") {
        sendJson(response, 405, {
            ok: false,
            error: `Method not allowed: ${request.method}`,
        });
        return;
    }

    const payload = await readJsonBody(request);
    const settings = writeSettings(payload);
    const checks = {
        atlasOutputDir: validateDirectoryPath(settings.atlasOutputDir),
        tsOutputDir: validateDirectoryPath(settings.tsOutputDir),
    };
    const ok = checks.atlasOutputDir.ok && checks.tsOutputDir.ok;

    sendJson(response, ok ? 200 : 400, {
        ok,
        settings,
        checks,
    });
}

module.exports = {
    handleSettingsRequest,
    handleChooseDirectoryRequest,
    handleValidateSettingsRequest,
};
