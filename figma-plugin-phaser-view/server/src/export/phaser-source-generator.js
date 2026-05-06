const fs = require("fs");
const path = require("path");
const {
    normalizeAtlasBasePath,
    toCamelCase,
    toPascalCase,
} = require("../utils/path-utils");

const TEMPLATES_DIR = path.join(__dirname, "templates");

/**
 * Reads and renders a small TypeScript template from server/src/export/templates.
 */
function renderTemplate(templateName, values) {
    const templatePath = path.join(TEMPLATES_DIR, templateName);
    const template = fs.readFileSync(templatePath, "utf8");

    return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key) => {
        return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : "";
    });
}

/**
 * ============================================================================
 * Phaser TypeScript Source Generation
 * ============================================================================
 *
 * Generates typed asset metadata plus class-based Phaser view components.
 */

/**
 * Builds a runtime atlas file URL from a normalized base path and file name.
 */
function buildAtlasFilePath(basePath, fileName) {
    const cleanFileName = String(fileName || "").replace(/^\/+/, "");
    return `${normalizeAtlasBasePath(basePath)}${cleanFileName}`;
}

/**
 * Creates a unique safe asset key for generated TypeScript object properties.
 */
function createUniqueAssetKey(rawName, used) {
    const base = toCamelCase(rawName);
    let next = base || "asset";
    let suffix = 2;

    while (used.has(next)) {
        next = `${base}${suffix}`;
        suffix += 1;
    }

    used.add(next);
    return next;
}

/**
 * Extracts nine-slice padding from names like "button.nine.20".
 */
function detectNinePadding(rawName) {
    const match = String(rawName || "").trim().match(/(?:^|[._-])nine\.(\d+)$/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
}

/**
 * Строит ключ object literal из имени слоя Figma.
 */
function buildObjectKey(rawName) {
    const key = String(rawName || "");
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
        return key;
    }

    return `'${key
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")}'`;
}

/**
 * Строит обращение к полю children с учетом quoted keys.
 */
function buildObjectAccess(objectRef, rawName) {
    const key = String(rawName || "");
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
        return `${objectRef}.${key}`;
    }

    return `${objectRef}[${buildObjectKey(key)}]`;
}

/**
 * Converts manifest items into sorted generated asset entries.
 */
function buildAssetEntries(manifest) {
    const usedAssetKeys = new Set();
    const entries = manifest.items.map((item) => {
        const frameBaseName = String(item.fileName || "item.png").replace(/\.png$/i, "");
        const assetKey = createUniqueAssetKey(frameBaseName, usedAssetKeys);
        const kind = item.kind === "nine" ? "nine" : "image";
        const ninePadding = kind === "nine"
            ? (Number.isFinite(Number(item.ninePadding)) ? Number(item.ninePadding) : detectNinePadding(item.name || "") || 20)
            : undefined;

        return {
            assetKey,
            name: item.name || frameBaseName,
            kind,
            ninePadding,
            fileName: item.fileName,
            x: Number(item.x || 0),
            y: Number(item.y || 0),
            width: Number(item.width || 0),
            height: Number(item.height || 0),
            frameName: item.fileName,
        };
    });

    entries.sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        if (a.x !== b.x) return a.x - b.x;
        return a.assetKey.localeCompare(b.assetKey);
    });

    return entries;
}

/**
 * Resolves Phaser texture keys for atlas or standalone PNG export.
 */
function resolveAssetEntriesForExport(entries, props) {
    const { exportMode, atlasPngUrl, atlasBasePath } = props;
    const isPngExport = exportMode === "png";

    return entries.map((entry) => ({
        ...entry,
        textureUrl: isPngExport
            ? buildAtlasFilePath(atlasBasePath, `png/${entry.frameName}`)
            : atlasPngUrl,
        textureFrameName: isPngExport ? null : entry.frameName,
    }));
}

/**
 * Generates the pack-specific asset registry and preload function.
 */
function buildAssetsTs(props) {
    const { entries, packName, packCamel, atlasPngUrl, atlasJsonUrl, exportMode } = props;
    const isPngExport = exportMode === "png";
    const assetsObjectLines = entries.map((entry) => {
        const ninePaddingLine = entry.kind === "nine" ? `\n    ninePadding: ${entry.ninePadding},` : "";
        const textureUrl = entry.textureUrl || atlasPngUrl;
        const textureFrameName = Object.prototype.hasOwnProperty.call(entry, "textureFrameName")
            ? entry.textureFrameName
            : entry.frameName;
        const frameName = textureFrameName === null
            ? "null"
            : JSON.stringify(String(textureFrameName || ""));

        return `  ${entry.assetKey}: {\n    name: ${JSON.stringify(String(entry.name || ""))},\n    url: ${JSON.stringify(String(textureUrl || ""))},\n    frameName: ${frameName},\n    width: ${entry.width},\n    height: ${entry.height},\n    x: ${entry.x},\n    y: ${entry.y},\n    kind: "${entry.kind}",${ninePaddingLine}\n  },`;
    });
    const orderLines = entries.map((entry) => `  "${entry.assetKey}",`);
    const preloadFunctionName = `preload${toPascalCase(packName)}Assets`;
    const preloadConfig = isPngExport
        ? `  preload: {\n    images: ${packCamel}AutoAssetOrder.map((assetName) => ${packCamel}AutoAssetsConst[assetName]),\n    atlases: [],\n  },`
        : `  preload: {\n    images: [],\n    atlases: [\n      {\n        name: "${packName}",\n        pngUrl: "${atlasPngUrl}",\n        jsonUrl: "${atlasJsonUrl}",\n      },\n    ],\n  },`;
    const autoAtlasLine = isPngExport
        ? `export const ${packCamel}AutoAtlas = null;\n`
        : `export const ${packCamel}AutoAtlas = ${packCamel}AutoAssetsConfig.preload.atlases[0];\n`;
    const preloadBody = isPngExport
        ? `  ${packCamel}AutoAssetOrder.forEach((assetName) => {\n    const asset = ${packCamel}AutoAssetsConst[assetName];\n    if (scene.textures.exists(asset.url)) return;\n    scene.load.image(asset.url, asset.url);\n  });`
        : `  ${packCamel}AutoAssetsConfig.preload.atlases.forEach((atlas) => {\n    if (scene.textures.exists(atlas.pngUrl)) return;\n    scene.load.atlas(atlas.pngUrl, atlas.pngUrl, atlas.jsonUrl);\n  });`;

    return `// This file is auto-generated by figma2assets plugin. Do not edit manually.

export const ${packCamel}AutoAssetsConst = {
${assetsObjectLines.join("\n")}
} as const;

export type AutoAssetName = keyof typeof ${packCamel}AutoAssetsConst;

export const ${packCamel}AutoAssetOrder: readonly AutoAssetName[] = [
${orderLines.join("\n")}
];

export const ${packCamel}AutoAssetsConfig = {
  images: ${packCamel}AutoAssetsConst,
${preloadConfig}
} as const;

export const ${packCamel}AutoAssets = ${packCamel}AutoAssetsConfig.images;
${autoAtlasLine}

/**
 * Preloads generated assets for this pack.
 */
export function ${preloadFunctionName}(scene: Phaser.Scene): void {
${preloadBody}
}
`;
}

/**
 * Resolves view child metadata against generated asset, view, and text entries.
 */
function buildViewEntries(manifest, assetEntries) {
    const assetsByFileName = new Map(assetEntries.map((entry) => [entry.frameName, entry]));
    const rawEntries = Array.isArray(manifest.views) ? manifest.views : [];
    const entriesByNodeId = new Map(rawEntries.map((entry) => [entry.nodeId, entry]));
    const entriesByFunctionName = new Map(rawEntries.map((entry) => [entry.functionName, entry]));

    return rawEntries.map((entry) => {
        const children = Array.isArray(entry.children)
            ? entry.children.map((child) => {
                const childType = child.type || "asset";

                if (childType === "view" || childType === "text") {
                    const childEntry =
                        entriesByNodeId.get(child.viewNodeId || child.textNodeId || child.nodeId) ||
                        entriesByFunctionName.get(child.viewFunctionName || child.textFunctionName);

                    if (!childEntry) return null;

                    const dataName = childEntry.dataName || `${childEntry.functionName}Data`;
                    if (childType === "view") {
                        return {
                            ...child,
                            type: "view",
                            viewKind: childEntry.kind,
                            viewName: childEntry.name,
                            viewFunctionName: childEntry.functionName,
                            viewDataName: dataName,
                        };
                    }

                    return {
                        ...child,
                        type: "text",
                        textName: childEntry.name,
                        textFunctionName: childEntry.functionName,
                    };
                }

                const assetEntry = assetsByFileName.get(child.assetFileName);
                if (!assetEntry) return null;

                return {
                    ...child,
                    type: "asset",
                    assetKey: assetEntry.assetKey,
                    asset: assetEntry,
                };
            }).filter(Boolean)
            : [];

        return {
            ...entry,
            dataName: entry.dataName || `${entry.functionName}Data`,
            children,
        };
    });
}

/**
 * Sorts generated view declarations so child view data exists before parents.
 */
function sortViewEntriesForDeclarations(viewEntries) {
    const entriesByFunctionName = new Map(viewEntries.map((entry) => [entry.functionName, entry]));
    const visiting = new Set();
    const visited = new Set();
    const result = [];

    function visit(entry) {
        if (!entry || visited.has(entry.functionName)) return;
        if (visiting.has(entry.functionName)) return;

        visiting.add(entry.functionName);

        entry.children
            .filter((child) => child.type === "view")
            .forEach((child) => {
                visit(entriesByFunctionName.get(child.viewFunctionName));
            });

        visiting.delete(entry.functionName);
        visited.add(entry.functionName);
        result.push(entry);
    }

    viewEntries.forEach((entry) => {
        visit(entry);
    });

    return result;
}

/**
 * Возвращает пробелы для читабельного generated TypeScript.
 */
function indent(level) {
    return " ".repeat(level);
}

/**
 * Генерирует значение одного child внутри children object.
 * Для view child данные вкладываются сразу, без отдельной константы и без поля view.
 */
function buildViewChildBlock(props) {
    const {
        child,
        packCamel,
        entriesByFunctionName = new Map(),
        rootEntriesByName = new Map(),
        currentRoot = null,
        visiting = new Set(),
        baseIndent = 4,
    } = props;
    const pad = indent(baseIndent);
    if (child.type === "view") {
        const rootReferenceEntry = findRootReferenceEntry(child, rootEntriesByName, currentRoot);
        if (rootReferenceEntry) {
            return `{\n${pad}  type: "view",\n${pad}  rootRef: ${JSON.stringify(String(rootReferenceEntry.name || child.name || ""))},\n${pad}  x: ${Number(child.x || 0)},\n${pad}  y: ${Number(child.y || 0)},\n${pad}  width: ${Number(child.width || 0)},\n${pad}  height: ${Number(child.height || 0)},\n${pad}}`;
        }

        const childEntry = entriesByFunctionName.get(child.viewFunctionName);
        const buttonLine = childEntry && childEntry.button ? `\n${pad}  button: true,` : "";
        const childrenBlock = childEntry && !visiting.has(childEntry.functionName)
            ? buildChildrenObjectLiteral(
                childEntry.children,
                packCamel,
                entriesByFunctionName,
                rootEntriesByName,
                currentRoot,
                new Set([...visiting, childEntry.functionName]),
                baseIndent + 2,
            )
            : "{\n" + indent(baseIndent + 2) + "}";

        return `{\n${pad}  type: "view",\n${pad}  name: ${JSON.stringify(String((childEntry && childEntry.name) || child.name || ""))},${buttonLine}\n${pad}  x: ${Number(child.x || 0)},\n${pad}  y: ${Number(child.y || 0)},\n${pad}  width: ${Number(child.width || 0)},\n${pad}  height: ${Number(child.height || 0)},\n${pad}  children: ${childrenBlock},\n${pad}}`;
    }

    if (child.type === "text") {
        return `{\n${pad}  type: "text",\n${pad}  text: ${packCamel}Texts[${JSON.stringify(String(child.textName || child.name || ""))}],\n${pad}  x: ${Number(child.x || 0)},\n${pad}  y: ${Number(child.y || 0)},\n${pad}  width: ${Number(child.width || 0)},\n${pad}  height: ${Number(child.height || 0)},\n${pad}}`;
    }

    return `{\n${pad}  asset: ${packCamel}AutoAssets.${child.assetKey},\n${pad}  x: ${Number(child.x || 0)},\n${pad}  y: ${Number(child.y || 0)},\n${pad}  width: ${Number(child.width || 0)},\n${pad}  height: ${Number(child.height || 0)},\n${pad}}`;
}

/**
 * Схлопывает children в object-модель перед генерацией текста.
 * При повторе имени Figma последнее поле перетирает предыдущее,
 * как это сделал бы настоящий JS object literal во время выполнения.
 */
function collapseChildrenForObjectLiteral(children) {
    const childrenByName = new Map();

    (Array.isArray(children) ? children : []).forEach((child) => {
        const childName = String(child.name || "");
        if (childrenByName.has(childName)) {
            childrenByName.delete(childName);
        }
        childrenByName.set(childName, child);
    });

    return Array.from(childrenByName.values());
}

/**
 * Генерирует object literal для children с теми же правилами перетирания дублей.
 */
function buildChildrenObjectLiteral(children, packCamel, entriesByFunctionName, rootEntriesByName, currentRoot, visiting, baseIndent) {
    const childBlocks = collapseChildrenForObjectLiteral(children).map((child) => {
        return `${indent(baseIndent + 2)}${buildObjectKey(child.name)}: ${buildViewChildBlock({
            child,
            packCamel,
            entriesByFunctionName,
            rootEntriesByName,
            currentRoot,
            visiting,
            baseIndent: baseIndent + 2,
        })},`;
    });

    if (childBlocks.length === 0) {
        return "{\n" + indent(baseIndent) + "}";
    }

    return `{\n${childBlocks.join("\n")}\n${indent(baseIndent)}}`;
}

/**
 * Converts a text style snapshot into generated TS object literal.
 */
function buildTextStyleLiteral(style) {
    const snapshot = style && typeof style === "object" ? style : {};
    const lines = [];

    if (snapshot.fontFamily) {
        lines.push(`    fontFamily: ${JSON.stringify(String(snapshot.fontFamily))},`);
    }

    if (snapshot.fontSize !== undefined && snapshot.fontSize !== null && Number.isFinite(Number(snapshot.fontSize))) {
        lines.push(`    fontSize: ${Number(snapshot.fontSize)},`);
    }

    if (snapshot.color) {
        lines.push(`    color: ${JSON.stringify(String(snapshot.color))},`);
    }

    if (snapshot.align) {
        lines.push(`    align: ${JSON.stringify(String(snapshot.align))},`);
    }

    if (snapshot.stroke) {
        lines.push(`    stroke: ${JSON.stringify(String(snapshot.stroke))},`);
    }

    if (snapshot.strokeThickness !== undefined && snapshot.strokeThickness !== null && Number.isFinite(Number(snapshot.strokeThickness))) {
        lines.push(`    strokeThickness: ${Number(snapshot.strokeThickness)},`);
    }

    if (lines.length === 0) {
        return "{}";
    }

    return `{\n${lines.join("\n")}\n  }`;
}

/**
 * Converts base text into a locale map literal.
 */
function buildTextLocaleMapLiteral(baseText) {
    const value = JSON.stringify(String(baseText || ""));
    return `{\n  en: ${value},\n  ru: ${value},\n}`;
}

/**
 * Returns true if any generated view contains direct text children.
 */
function hasTextChildren(viewEntries) {
    return viewEntries.some((view) =>
        Array.isArray(view.children) && view.children.some((child) => child.type === "text")
    );
}

/**
 * Returns true if any generated view contains direct asset children.
 */
function hasAssetChildren(viewEntries) {
    return viewEntries.some((view) =>
        Array.isArray(view.children) && view.children.some((child) => (child.type || "asset") === "asset")
    );
}

/**
 * Returns true if any generated view contains direct nested view children.
 */
function hasViewChildren(viewEntries) {
    return viewEntries.some((view) =>
        Array.isArray(view.children) && view.children.some((child) => child.type === "view")
    );
}

/**
 * Generates one text data object field.
 */
function buildTextObjectField(entry) {
    const styleLiteral = buildTextStyleLiteral(entry.textStyle);
    const localeMapLiteral = buildTextLocaleMapLiteral(entry.baseText);

    return `  ${buildObjectKey(entry.name)}: {\n    name: ${JSON.stringify(String(entry.name || ""))},\n    x: ${Number(entry.x || 0)},\n    y: ${Number(entry.y || 0)},\n    width: ${Number(entry.width || 0)},\n    height: ${Number(entry.height || 0)},\n    localeMap: ${localeMapLiteral.replace(/\n/g, "\n    ")},\n    style: ${styleLiteral.replace(/\n/g, "\n  ")},\n  },`;
}

/**
 * Генерирует view data без явной TS-аннотации, чтобы IDE видела поля children.
 */
function buildViewDataLiteral(view, packCamel, entriesByFunctionName = new Map(), rootEntriesByName = new Map(), currentRoot = view) {
    const buttonLine = view.button ? "\n  button: true," : "";
    const childrenBlock = buildChildrenObjectLiteral(
        view.children,
        packCamel,
        entriesByFunctionName,
        rootEntriesByName,
        currentRoot,
        new Set([view.functionName]),
        2,
    );

    return `{\n  name: ${JSON.stringify(String(view.name || ""))},${buttonLine}\n  width: ${Number(view.width || 0)},\n  height: ${Number(view.height || 0)},\n  children: ${childrenBlock},\n}`;
}

/**
 * Builds a large generated section header.
 */
function buildSectionHeader(title) {
    return `/**************\n *\n * ${title}\n *\n **************/`;
}

/**
 * Создает уникальное локальное имя переменной внутри generated function.
 */
function createUniqueLocalName(rawName, used, nameSuffix = "") {
    const base = toCamelCasePreservingCamel(rawName) || "child";
    let next = `${base}${nameSuffix}`;
    let index = 2;

    while (used.has(next)) {
        next = `${base}${nameSuffix}${index}`;
        index += 1;
    }

    used.add(next);
    return next;
}

/**
 * Делает camelCase для локальных переменных без разрушения уже нормального camelCase из Figma.
 */
function toCamelCasePreservingCamel(input) {
    const pascal = toPascalCasePreservingCamel(input);
    const result = pascal.charAt(0).toLowerCase() + pascal.slice(1);

    return /^[0-9]/.test(result) ? `n${result}` : result;
}

/**
 * Converts an already-safe generated identifier to PascalCase without re-normalizing it.
 */
function capitalizeIdentifier(identifier) {
    const value = String(identifier || "");
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Генерирует блок data-констант без общего типа у каждой константы.
 */
function buildViewConstantsBlock(viewEntries, packCamel, entriesByFunctionName = new Map(), rootEntriesByName = new Map()) {
    const blocks = viewEntries.map((view) => {
        return `export const ${view.dataName} = ${buildViewDataLiteral(view, packCamel, entriesByFunctionName, rootEntriesByName, view)};`;
    });

    return `${buildSectionHeader("CONSTANTS")}\n\n${blocks.join("\n\n")}`;
}

/**
 * Finds top-level generated view entries for section grouping.
 */
function findRootViewEntries(viewEntries) {
    const referencedFunctionNames = new Set();

    viewEntries.forEach((view) => {
        if (!Array.isArray(view.children)) return;

        view.children.forEach((child) => {
            if (child.type !== "view") return;
            if (!child.viewFunctionName) return;
            referencedFunctionNames.add(child.viewFunctionName);
        });
    });

    return viewEntries.filter((view) => !referencedFunctionNames.has(view.functionName));
}

/**
 * Берет root views из manifest.isRoot, а для старых manifest оставляет прежний fallback.
 */
function findPageRootViewEntries(viewEntries) {
    const explicitRoots = viewEntries.filter((view) => view.isRoot);
    if (explicitRoots.length > 0) return explicitRoots;
    return findRootViewEntries(viewEntries);
}

/**
 * Индекс root views по имени Figma для component-like ссылок из nested children.
 */
function buildRootEntriesByName(rootEntries) {
    const result = new Map();

    rootEntries.forEach((entry) => {
        result.set(String(entry.name || ""), entry);
    });

    return result;
}

/**
 * Root reference определяется по имени Figma child.
 * Это осознанный component-like контракт: имя вложенного view выбирает root factory.
 */
function findRootReferenceEntry(child, rootEntriesByName, currentRoot) {
    if (!child || child.type !== "view") return null;

    const rootEntry = rootEntriesByName.get(String(child.name || ""));
    if (!rootEntry) return null;

    if (currentRoot && rootEntry.functionName === currentRoot.functionName) {
        return null;
    }

    return rootEntry;
}

/**
 * Собирает nested view/button для root section.
 * Имена builder-функций не уникализируются: если в Figma есть дубли,
 * generated TypeScript должен показать конфликт, чтобы оператор исправил имена в Figma.
 */
function collectNestedBuilderEntries(root, entriesByFunctionName, rootEntriesByName) {
    const result = [];
    const seen = new Set();

    /**
     * Рекурсивно собирает private builders для nested view и запоминает прямой путь к data каждого builder.
     */
    function collectNestedBuilderEntryRefs(entry, currentRoot, parentDataRef) {
        if (!entry || !Array.isArray(entry.children)) return;

        collapseChildrenForObjectLiteral(entry.children).forEach((child) => {
            if (child.type !== "view") return;
            if (findRootReferenceEntry(child, rootEntriesByName, currentRoot)) return;

            const childEntry = entriesByFunctionName.get(child.viewFunctionName);
            if (!childEntry) return;

            const childDataRef = buildObjectAccess(`${parentDataRef}.children`, child.name);

            if (!seen.has(childEntry.functionName)) {
                seen.add(childEntry.functionName);
                result.push({
                    entry: childEntry,
                    dataRef: childDataRef,
                });
            }
            collectNestedBuilderEntryRefs(childEntry, currentRoot, childDataRef);
        });
    }

    collectNestedBuilderEntryRefs(root, root, root.dataName);
    return result;
}

/**
 * Строит имя private builder напрямую из имени Figma.
 * Суффиксы для дублей не добавляются: конфликт должен быть виден в generated TS.
 */
function buildPrivateBuilderName(viewEntry) {
    return `build${toPascalCasePreservingCamel((viewEntry && viewEntry.name) || "View")}`;
}

/**
 * Делает PascalCase для builder-функций без разрушения уже нормального camelCase из Figma.
 */
function toPascalCasePreservingCamel(input) {
    const tokens = String(input || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean);

    const result = tokens.map((token) => {
        const hasInnerUpperCase = /[A-Z]/.test(token.slice(1));
        const normalized = hasInnerUpperCase ? token : token.toLowerCase();
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }).join("");
    const safe = result || "View";

    return /^[0-9]/.test(safe) ? `N${safe}` : safe;
}

/**
 * Converts a text style snapshot into a serializable object for local text constants.
 */
function buildTextStyleObject(style) {
    const snapshot = style && typeof style === "object" ? style : {};
    const result = {};

    if (snapshot.fontFamily) {
        result.fontFamily = String(snapshot.fontFamily);
    }

    if (snapshot.fontSize !== undefined && snapshot.fontSize !== null && Number.isFinite(Number(snapshot.fontSize))) {
        result.fontSize = Number(snapshot.fontSize);
    }

    if (snapshot.color) {
        result.color = String(snapshot.color);
    }

    if (snapshot.align) {
        result.align = String(snapshot.align);
    }

    if (snapshot.stroke) {
        result.stroke = String(snapshot.stroke);
    }

    if (snapshot.strokeThickness !== undefined && snapshot.strokeThickness !== null && Number.isFinite(Number(snapshot.strokeThickness))) {
        result.strokeThickness = Number(snapshot.strokeThickness);
    }

    return result;
}

/**
 * Builds a deterministic TypeScript literal using JSON-compatible generated data.
 */
function buildTsLiteral(value) {
    return JSON.stringify(value, null, 2);
}

/**
 * Creates stable class names for every generated view entry.
 */
function buildViewClassNameMap(viewEntries) {
    const usedClassNames = new Set();
    const result = new Map();

    viewEntries.forEach((entry) => {
        const rawBase = entry.name || entry.functionName || "View";
        const base = toPascalCasePreservingCamel(rawBase);
        let next = base;
        let suffix = 2;

        while (usedClassNames.has(next)) {
            next = `${base}${suffix}`;
            suffix += 1;
        }

        usedClassNames.add(next);
        result.set(entry.functionName, next);
    });

    return result;
}

/**
 * Builds import statements from a source -> names map.
 */
function buildImportBlock(importsBySource) {
    const lines = Array.from(importsBySource.entries())
        .filter(([, names]) => names.size > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, names]) => {
            const sortedNames = Array.from(names).sort((a, b) => a.localeCompare(b));
            return `import { ${sortedNames.join(", ")} } from ${JSON.stringify(source)};`;
        });

    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/**
 * Adds a named import to the class file import model.
 */
function addNamedImport(importsBySource, source, name) {
    if (!importsBySource.has(source)) {
        importsBySource.set(source, new Set());
    }

    importsBySource.get(source).add(name);
}

/**
 * Builds copied texture asset data for a view file.
 */
function buildInlineAssetData(assetEntry) {
    const data = {
        name: String(assetEntry.name || ""),
        url: String(assetEntry.textureUrl || ""),
        frameName: assetEntry.textureFrameName === null ? null : String(assetEntry.textureFrameName || assetEntry.frameName || ""),
        width: Number(assetEntry.width || 0),
        height: Number(assetEntry.height || 0),
        x: Number(assetEntry.x || 0),
        y: Number(assetEntry.y || 0),
        kind: assetEntry.kind === "nine" ? "nine" : "image",
    };

    if (data.kind === "nine") {
        data.ninePadding = Number(assetEntry.ninePadding || 20);
    }

    return data;
}

/**
 * Returns direct children after applying object-literal duplicate key semantics.
 */
function getClassViewChildren(view) {
    return collapseChildrenForObjectLiteral(view.children || []);
}

/**
 * Detects the common button template: one nine-slice background plus one text label.
 */
function findCenteredButtonPair(view) {
    const children = getClassViewChildren(view);
    const nineChildren = children.filter((child) => child.type !== "view" && child.type !== "text" && child.asset && child.asset.kind === "nine");
    const textChildren = children.filter((child) => child.type === "text");

    if (!view.button || children.length !== 2 || nineChildren.length !== 1 || textChildren.length !== 1) {
        return null;
    }

    return {
        backgroundChild: nineChildren[0],
        textChild: textChildren[0],
    };
}

/**
 * Builds local text constants for one generated view class.
 */
function buildViewTextConstants(view, entriesByFunctionName, constName) {
    const textDataByName = {};

    getClassViewChildren(view)
        .filter((child) => child.type === "text")
        .forEach((child) => {
            const textEntry = entriesByFunctionName.get(child.textFunctionName);
            if (!textEntry) return;

            const value = String(textEntry.baseText || "");
            textDataByName[String(child.name || child.textName || "")] = {
                localeMap: {
                    en: value,
                    ru: value,
                },
                style: buildTextStyleObject(textEntry.textStyle),
            };
        });

    if (Object.keys(textDataByName).length === 0) {
        return "";
    }

    return `const ${constName} = ${buildTsLiteral(textDataByName)} as const;\n\n`;
}

/**
 * Builds local copied asset constants for one generated view class.
 */
function buildViewAssetConstants(view, constName) {
    const assetDataByName = {};

    getClassViewChildren(view)
        .filter((child) => child.type !== "view" && child.type !== "text")
        .forEach((child) => {
            const assetEntry = child.asset;
            if (!assetEntry) return;

            assetDataByName[String(child.name || assetEntry.name || "")] = {
                asset: buildInlineAssetData(assetEntry),
                x: Number(child.x || 0),
                y: Number(child.y || 0),
                width: Number(child.width || 0),
                height: Number(child.height || 0),
            };
        });

    if (Object.keys(assetDataByName).length === 0) {
        return "";
    }

    return `const ${constName} = ${buildTsLiteral(assetDataByName)} as const;\n\n`;
}

/**
 * Builds an asset child constructor block for a generated class.
 */
function buildClassAssetChildLines(props) {
    const {
        child,
        childVarName,
        assetConstName,
        viewWidthRef,
        viewHeightRef,
        shouldStretchToView,
    } = props;
    const childKey = JSON.stringify(String(child.name || ""));
    const dataVarName = `${childVarName}Data`;
    const assetVarName = `${childVarName}Asset`;
    const widthExpr = shouldStretchToView ? `${viewWidthRef}` : `${dataVarName}.width`;
    const heightExpr = shouldStretchToView ? `${viewHeightRef}` : `${dataVarName}.height`;

    if (child.asset && child.asset.kind === "nine") {
        return [
            `    const ${dataVarName} = ${assetConstName}[${childKey}];`,
            `    const ${assetVarName} = ${dataVarName}.asset;`,
            `    const ${childVarName} = new Phaser.GameObjects.NineSlice(`,
            `      scene,`,
            `      0,`,
            `      0,`,
            `      ${assetVarName}.url,`,
            `      ${assetVarName}.frameName ?? undefined,`,
            `      ${widthExpr},`,
            `      ${heightExpr},`,
            `      ${assetVarName}.ninePadding ?? 20,`,
            `      ${assetVarName}.ninePadding ?? 20,`,
            `      ${assetVarName}.ninePadding ?? 20,`,
            `      ${assetVarName}.ninePadding ?? 20,`,
            `    );`,
            `    ${childVarName}.name = ${assetVarName}.name || "";`,
            `    setLeftTop(${childVarName}, ${dataVarName}.x - ${viewWidthRef} / 2, ${dataVarName}.y - ${viewHeightRef} / 2);`,
            `    this.add(${childVarName});`,
        ].join("\n");
    }

    return [
        `    const ${dataVarName} = ${assetConstName}[${childKey}];`,
        `    const ${assetVarName} = ${dataVarName}.asset;`,
        `    const ${childVarName} = new Phaser.GameObjects.Image(scene, 0, 0, ${assetVarName}.url, ${assetVarName}.frameName ?? undefined);`,
        `    ${childVarName}.name = ${assetVarName}.name || "";`,
        `    setLeftTop(${childVarName}, ${dataVarName}.x - ${viewWidthRef} / 2, ${dataVarName}.y - ${viewHeightRef} / 2);`,
        `    this.add(${childVarName});`,
    ].join("\n");
}

/**
 * Builds a text child constructor block for a generated class.
 */
function buildClassTextChildLines(props) {
    const {
        child,
        childVarName,
        textConstName,
        viewWidthRef,
        viewHeightRef,
        shouldSkipPlacement,
    } = props;
    const childKey = JSON.stringify(String(child.name || child.textName || ""));
    const dataVarName = `${childVarName}Data`;
    const localeMapVarName = `${childVarName}LocaleMap`;
    const styleVarName = `${childVarName}Style`;
    const placementLine = shouldSkipPlacement
        ? ""
        : `\n    setLeftTop(${childVarName}, ${Number(child.x || 0)} - ${viewWidthRef} / 2, ${Number(child.y || 0)} - ${viewHeightRef} / 2);`;

    return [
        `    const ${dataVarName} = ${textConstName}[${childKey}];`,
        `    const ${localeMapVarName} = ${dataVarName}.localeMap as Record<string, string>;`,
        `    const ${styleVarName} = {`,
        `      ...${dataVarName}.style,`,
        `      ...(props.fontSize === undefined ? {} : { fontSize: props.fontSize }),`,
        `    };`,
        `    const ${childVarName} = new Phaser.GameObjects.Text(`,
        `      scene,`,
        `      0,`,
        `      0,`,
        `      String(${localeMapVarName}[locale] ?? ${localeMapVarName}.ru ?? ${localeMapVarName}.en ?? ""),`,
        `      ${styleVarName},`,
        `    );`,
        `    ${childVarName}.name = ${JSON.stringify(String(child.name || child.textName || ""))};`,
        `    ${childVarName}.setOrigin(0, 0);${placementLine}`,
        `    this.add(${childVarName});`,
    ].join("\n");
}

/**
 * Builds a nested view constructor block for a generated class.
 */
function buildClassNestedViewChildLines(props) {
    const {
        child,
        childVarName,
        classNameMap,
        viewWidthRef,
        viewHeightRef,
    } = props;
    const nestedClassName = classNameMap.get(child.viewFunctionName);

    if (!nestedClassName) {
        return `    // Skipped unresolved nested view: ${String(child.name || child.viewFunctionName || "")}`;
    }

    return [
        `    const ${childVarName} = new ${nestedClassName}({`,
        `      scene,`,
        `      width: ${Number(child.width || 0)},`,
        `      height: ${Number(child.height || 0)},`,
        `      locale: props.locale,`,
        `    });`,
        `    setLeftTop(${childVarName}, ${Number(child.x || 0)} - ${viewWidthRef} / 2, ${Number(child.y || 0)} - ${viewHeightRef} / 2);`,
        `    this.add(${childVarName});`,
    ].join("\n");
}

/**
 * Builds the constructor body for one generated view class.
 */
function buildViewClassConstructorBody(props) {
    const {
        view,
        classNameMap,
        textConstName,
        assetConstName,
    } = props;
    const children = getClassViewChildren(view);
    const hasText = children.some((child) => child.type === "text");
    const centerPair = findCenteredButtonPair(view);
    const usedLocalNames = new Set(["scene", "viewWidth", "viewHeight", "locale"]);
    const childVarNames = new Map();

    children.forEach((child) => {
        childVarNames.set(child, createUniqueLocalName(child.name || child.viewName || child.textName || "child", usedLocalNames));
    });

    const lines = [
        `    const scene = props.scene;`,
        `    const viewWidth = props.width ?? ${Number(view.width || 0)};`,
        `    const viewHeight = props.height ?? ${Number(view.height || 0)};`,
        `    this.name = ${JSON.stringify(String(view.name || ""))};`,
        `    this.setSize(viewWidth, viewHeight);`,
    ];

    if (hasText) {
        lines.push(`    const locale = props.locale ?? getSceneLocale(scene) ?? "ru";`);
    }

    children.forEach((child) => {
        const childVarName = childVarNames.get(child);

        if (child.type === "view") {
            lines.push("");
            lines.push(buildClassNestedViewChildLines({
                child,
                childVarName,
                classNameMap,
                viewWidthRef: "viewWidth",
                viewHeightRef: "viewHeight",
            }));
            return;
        }

        if (child.type === "text") {
            lines.push("");
            lines.push(buildClassTextChildLines({
                child,
                childVarName,
                textConstName,
                viewWidthRef: "viewWidth",
                viewHeightRef: "viewHeight",
                shouldSkipPlacement: centerPair && centerPair.textChild === child,
            }));
            return;
        }

        lines.push("");
        lines.push(buildClassAssetChildLines({
            child,
            childVarName,
            assetConstName,
            viewWidthRef: "viewWidth",
            viewHeightRef: "viewHeight",
            shouldStretchToView: centerPair && centerPair.backgroundChild === child,
        }));
    });

    if (centerPair) {
        const bgVarName = childVarNames.get(centerPair.backgroundChild);
        const textVarName = childVarNames.get(centerPair.textChild);
        lines.push("");
        lines.push(`    center(${bgVarName}, ${textVarName});`);
    }

    if (view.button) {
        lines.push("");
        lines.push(`    this.setData("button", true);`);
        lines.push(`    makeContainerInteractive(this);`);
    }

    return lines.join("\n");
}

/**
 * Builds one generated view class file.
 */
function buildViewClassFile(props) {
    const {
        view,
        entriesByFunctionName,
        classNameMap,
    } = props;
    const className = classNameMap.get(view.functionName);
    const classCamel = toCamelCasePreservingCamel(className);
    const propsInterfaceName = `I${className}Props`;
    const textConstName = `${classCamel}Texts`;
    const assetConstName = `${classCamel}Assets`;
    const children = getClassViewChildren(view);
    const importsBySource = new Map();
    const hasText = children.some((child) => child.type === "text");
    const hasChildPlacement = children.length > 0;
    const hasCenteredButtonPair = Boolean(findCenteredButtonPair(view));

    if (hasChildPlacement) {
        addNamedImport(importsBySource, "../utils/utils", "setLeftTop");
    }

    if (hasCenteredButtonPair) {
        addNamedImport(importsBySource, "../utils/utils", "center");
    }

    if (view.button) {
        addNamedImport(importsBySource, "../utils/utils", "makeContainerInteractive");
    }

    if (hasText) {
        addNamedImport(importsBySource, "../utils/scene-locale", "getSceneLocale");
    }

    children
        .filter((child) => child.type === "view")
        .forEach((child) => {
            const nestedClassName = classNameMap.get(child.viewFunctionName);
            if (!nestedClassName || nestedClassName === className) return;
            addNamedImport(importsBySource, `./${nestedClassName}`, nestedClassName);
        });

    const textConstants = buildViewTextConstants(view, entriesByFunctionName, textConstName);
    const assetConstants = buildViewAssetConstants(view, assetConstName);
    const constructorBody = buildViewClassConstructorBody({
        view,
        classNameMap,
        textConstName,
        assetConstName,
    });
    return renderTemplate("view-class.ts.tpl", {
        imports: buildImportBlock(importsBySource),
        textConstants,
        assetConstants,
        propsInterfaceName,
        className,
        constructorBody,
    });
}

/**
 * Builds a barrel file for generated view classes.
 */
function buildViewIndexTs(viewEntries, classNameMap) {
    const exports = viewEntries
        .map((entry) => {
            const className = classNameMap.get(entry.functionName);
            if (!className) return "";
            return `export { ${className} } from "./${className}";`;
        })
        .filter(Boolean)
        .join("\n");

    return renderTemplate("view-index.ts.tpl", {
        exports: exports ? `${exports}\n` : "",
    });
}

/**
 * Generates separate class files for all renderable view/button entries.
 */
function buildViewClassSources(props) {
    const {
        viewEntries,
    } = props;
    const resolvedEntries = sortViewEntriesForDeclarations(
        (Array.isArray(viewEntries) ? viewEntries : []).filter((entry) => entry.kind !== "text")
    );
    const entriesByFunctionName = new Map((Array.isArray(viewEntries) ? viewEntries : []).map((entry) => [entry.functionName, entry]));
    const classNameMap = buildViewClassNameMap(resolvedEntries);
    const viewFiles = resolvedEntries.map((view) => {
        const className = classNameMap.get(view.functionName);

        return {
            relativePath: `views/${className}.ts`,
            code: buildViewClassFile({
                view,
                entriesByFunctionName,
                classNameMap,
            }),
        };
    });

    return {
        viewFiles,
        viewIndexTs: buildViewIndexTs(resolvedEntries, classNameMap),
    };
}

/**
 * Generates pack assets.ts and class-based views.
 */
function buildPhaserSceneSources(props) {
    const { packName, manifest, atlasBasePath } = props;
    const exportMode = props.exportMode === "png" ? "png" : "atlas";
    const packCamel = toCamelCase(packName);
    const atlasPngUrl = buildAtlasFilePath(atlasBasePath, `${packName}.png`);
    const atlasJsonUrl = buildAtlasFilePath(atlasBasePath, `${packName}.json`);
    const entries = resolveAssetEntriesForExport(buildAssetEntries(manifest), {
        exportMode,
        atlasPngUrl,
        atlasBasePath,
    });
    const renderableEntries = buildViewEntries(manifest, entries);
    const viewClassSources = buildViewClassSources({
        viewEntries: renderableEntries,
    });

    return {
        assetsTs: buildAssetsTs({
            entries,
            packName,
            packCamel,
            atlasPngUrl,
            atlasJsonUrl,
            exportMode,
        }),
        viewIndexTs: viewClassSources.viewIndexTs,
        viewTs: viewClassSources.viewIndexTs,
        viewFiles: viewClassSources.viewFiles,
        textTs: null,
    };
}

module.exports = {
    buildAtlasFilePath,
    buildObjectKey,
    buildObjectAccess,
    createUniqueAssetKey,
    detectNinePadding,
    buildAssetEntries,
    resolveAssetEntriesForExport,
    buildAssetsTs,
    buildViewEntries,
    sortViewEntriesForDeclarations,
    buildViewChildBlock,
    buildTextStyleLiteral,
    buildTextStyleObject,
    buildTextLocaleMapLiteral,
    hasTextChildren,
    hasAssetChildren,
    hasViewChildren,
    buildTextObjectField,
    collapseChildrenForObjectLiteral,
    buildViewDataLiteral,
    buildSectionHeader,
    createUniqueLocalName,
    capitalizeIdentifier,
    buildViewConstantsBlock,
    findRootViewEntries,
    findPageRootViewEntries,
    buildRootEntriesByName,
    findRootReferenceEntry,
    collectNestedBuilderEntries,
    buildPrivateBuilderName,
    renderTemplate,
    buildViewClassNameMap,
    buildInlineAssetData,
    findCenteredButtonPair,
    buildViewTextConstants,
    buildViewAssetConstants,
    buildViewClassFile,
    buildViewIndexTs,
    buildViewClassSources,
    buildPhaserSceneSources,
};
