const { packAsync } = require("free-tex-packer-core");
const { TEXTURE_PACKER_OPTIONS } = require("../../configs/texture-packer-config");

/**
 * ============================================================================
 * Texture Packer Input/Output Helpers
 * ============================================================================
 *
 * Converts Figma-exported PNG payloads into free-tex-packer input and indexes
 * its generated output files.
 */

/**
 * Converts encoded PNG entries into free-tex-packer image descriptors.
 */
function buildTexturePackerImages(files) {
    return files.map((file) => {
        if (!file || typeof file !== "object") {
            throw new Error("Invalid file entry");
        }

        if (typeof file.fileName !== "string" || file.fileName.length === 0) {
            throw new Error("File entry is missing fileName");
        }

        if (typeof file.bytesBase64 === "string" && file.bytesBase64.length > 0) {
            return {
                path: file.fileName,
                contents: Buffer.from(file.bytesBase64, "base64"),
            };
        }

        if (Array.isArray(file.bytes)) {
            return {
                path: file.fileName,
                contents: Buffer.from(file.bytes),
            };
        }

        throw new Error(`File "${file.fileName}" has invalid bytes`);
    });
}

/**
 * Indexes packed atlas output buffers by output file name.
 */
function extractPackedFilesByName(packedFiles) {
    const result = new Map();

    for (const file of packedFiles) {
        result.set(file.name, file.buffer);
    }

    return result;
}

/**
 * Packs exported PNG files into a Phaser 3 atlas with free-tex-packer.
 */
async function packAtlasWithFreeTexPacker(packName, images) {
    const options = {
        ...TEXTURE_PACKER_OPTIONS,
        textureName: packName,
    };

    return packAsync(images, options);
}

module.exports = {
    buildTexturePackerImages,
    extractPackedFilesByName,
    packAtlasWithFreeTexPacker,
};
