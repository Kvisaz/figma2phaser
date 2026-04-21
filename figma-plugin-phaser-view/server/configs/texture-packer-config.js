/**
 * ============================================================================
 * Texture Packer Configuration
 * ============================================================================
 *
 * Centralized free-tex-packer options. Export code should not hide packing
 * behavior inside implementation functions.
 */

const TEXTURE_PACKER_OPTIONS = {
    fixedSize: false,
    powerOfTwo: false,
    padding: 2,
    extrude: 0,
    allowRotation: false,
    detectIdentical: true,
    allowTrim: false,
    removeFileExtension: false,
    prependFolderName: false,
    exporter: "Phaser3",
    /** критично для минимизации размера, если отключить будет 2048x2048 **/
    packer: "MaxRectsPacker",
};

module.exports = {
    TEXTURE_PACKER_OPTIONS,
};
