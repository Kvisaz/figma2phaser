/**
 * ============================================================================
 * Atlas JSON Helpers
 * ============================================================================
 *
 * Normalizes generated Phaser atlas JSON before writing it to the game project.
 */

/**
 * Rewrites atlas JSON metadata so meta.image points to the generated PNG name.
 */
function rewriteAtlasJsonMetaImage(atlasJsonText, packName) {
    let atlasJson;

    try {
        atlasJson = JSON.parse(atlasJsonText);
    } catch (error) {
        throw new Error(`Failed to parse atlas json: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (atlasJson && atlasJson.meta && typeof atlasJson.meta === "object") {
        atlasJson.meta.image = `${packName}.png`;
    }

    return JSON.stringify(atlasJson, null, 2);
}

module.exports = {
    rewriteAtlasJsonMetaImage,
};
