/**
 * Figma plugin main thread.
 *
 * Задача:
 * - найти top-level view/button/text деревья на текущей странице;
 * - собрать/обновить assets frame;
 * - экспортировать текущие assets в PNG;
 * - собрать manifest.json с views;
 * - отправить в UI данные для синхронизации через companion server.
 */

const UI_WIDTH = 520;
const UI_HEIGHT = 360;
const SETTINGS_STORAGE_KEY = "figma-phaser-view-export-settings";
const ASSETS_CORE_FRAME_NAME = "assets-core";
const ASSETS_CORE_FRAME_WIDTH = 1920;
const ASSETS_CORE_FRAME_HEIGHT = 3600;
const ASSETS_CORE_FRAME_OFFSET_X = 200;
const ASSETS_COLLECTION_MARGIN = 40;
const ASSETS_COLLECTION_GAP = 40;
const ASSETS_ABOUT_TEXT_NAME = "assets-about";
const ASSETS_ABOUT_TEXT_FONT = { family: "Inter", style: "Regular" };
const ASSETS_ABOUT_TEXT_SIZE = 24;
const ASSETS_ABOUT_TEXT_GAP = 16;
const ASSETS_ABOUT_TEXT_CONTENT = "1. можно менять размеры NineSlice\n2. ассеты с одинаковыми именами заменяют друг друга";

/**
 * Настройки экспорта PNG для каждого верхнего ребенка.
 * SCALE=1 дает оригинальный размер узла в Figma.
 */
const IMAGE_EXPORT_SETTINGS = Object.freeze({
  format: "PNG",
  constraint: { type: "SCALE", value: 1 },
  // Важно: false позволяет экспортировать по видимому контенту,
  // включая то, что выходит за layout bounds (например, outer stroke).
  useAbsoluteBounds: false,
});

const SAFE_FILE_BASE_NAME_RE = /^[A-Za-z0-9._-]+$/;
const SAFE_FILE_BASE_NAME_CHAR_RE = /^[A-Za-z0-9._-]$/;

figma.showUI(__html__, {
  width: UI_WIDTH,
  height: UI_HEIGHT,
  themeColors: true,
});

postPageState();

/**
 * ============================================================================
 * Page State
 * ============================================================================
 *
 * Combines selection diagnostics and current page scan into one UI state update.
 */

/**
 * Отправляет текущее состояние страницы в UI.
 */
function postPageState() {
  const pageState = getPageState();
  figma.ui.postMessage({
    type: "PAGE_STATE",
    pageState,
  });
}

/**
 * Собирает selection diagnostic и scan diagnostic в один объект состояния.
 */
function getPageState() {
  return {
    selection: getSelectionDiagnostic(),
    scan: getCurrentPageScanDiagnostic(),
  };
}

/**
 * ============================================================================
 * Current Page Scan
 * ============================================================================
 *
 * Startup-only diagnostics for finding Figma nodes that can become view roots
 * or asset sources. This block does not affect export behavior.
 */

/**
 * Собирает диагностические списки по текущей странице Figma.
 */
function getCurrentPageScanDiagnostic() {
  const page = figma.currentPage;
  const result = {
    pageName: page.name || page.id,
    viewNodes: [],
    assetsFrames: [],
    scannedNodesCount: 0,
    hasAssetsFrames: false,
    assetsPackName: "",
  };

  scanPageChildren(page.children, result);
  result.hasAssetsFrames = result.assetsFrames.length > 0;
  result.assetsPackName = result.assetsFrames.length > 0
    ? slugify(result.assetsFrames[0].name || ASSETS_CORE_FRAME_NAME)
    : "";
  return result;
}

/**
 * Рекурсивно обходит детей страницы и накапливает найденные узлы.
 */
function scanPageChildren(nodes, result) {
  nodes.forEach((node) => {
    result.scannedNodesCount += 1;

    if (isRenderableNode(node)) {
      result.viewNodes.push(createScanEntry(node));
    }

    if (isAssetsFrameNode(node)) {
      result.assetsFrames.push(createScanEntry(node));
    }

    if (hasChildren(node)) {
      scanPageChildren(node.children, result);
    }
  });
}

/**
 * Возвращает semantic kind renderable узла.
 */
function getRenderableKind(node) {
  if (!node || !node.name) return null;
  if (node.type === "TEXT" && startsWithIgnoreCase(node.name, "text")) return "text";
  if (startsWithIgnoreCase(node.name, "button")) return "button";
  if (startsWithIgnoreCase(node.name, "view")) return "view";
  return null;
}

/**
 * Проверяет, является ли узел renderable контейнером или text root.
 */
function isRenderableNode(node) {
  return getRenderableKind(node) !== null;
}

/**
 * Проверяет, является ли узел renderable text node.
 */
function isRenderableTextNode(node) {
  return getRenderableKind(node) === "text";
}

/**
 * Проверяет, должен ли узел экспортироваться как обычный PNG asset.
 */
function isAssetCandidateNode(node) {
  return Boolean(node && node.visible !== false && !isRenderableNode(node));
}

/**
 * Проверяет, является ли узел фреймом с именем, начинающимся с "assets".
 */
function isAssetsFrameNode(node) {
  return node && node.type === "FRAME" && startsWithIgnoreCase(node.name, "assets");
}

/**
 * Проверяет prefix без учета регистра.
 */
function startsWithIgnoreCase(input, prefix) {
  return String(input || "").toLowerCase().startsWith(String(prefix || "").toLowerCase());
}

/**
 * Создает компактную запись для диагностического лога.
 */
function createScanEntry(node) {
  return {
    nodeId: node.id,
    type: node.type,
    name: node.name || node.id,
    path: getNodePath(node),
  };
}

/**
 * Собирает путь узла по именам родителей до текущей страницы.
 */
function getNodePath(node) {
  const names = [];
  let current = node;

  while (current && current.type !== "PAGE") {
    names.unshift(current.name || current.id);
    current = current.parent;
  }

  return names.join(" / ");
}

/**
 * Формирует текст отчета сканирования текущей страницы.
 */
function formatCurrentPageScanDiagnostic(diagnostic) {
  const lines = [
    `Скан страницы "${diagnostic.pageName}": просмотрено узлов ${diagnostic.scannedNodesCount}`,
    `Объекты view/button/text: ${diagnostic.viewNodes.length}`,
    ...formatScanEntryLines(diagnostic.viewNodes),
    `Фреймы assets*: ${diagnostic.assetsFrames.length}`,
    ...formatScanEntryLines(diagnostic.assetsFrames),
  ];

  return lines.join("\n");
}

/**
 * Формирует строки найденных узлов для лога.
 */
function formatScanEntryLines(entries) {
  if (entries.length === 0) {
    return ["- не найдено"];
  }

  return entries.map((entry) => `- [${entry.type}] ${entry.path} (${entry.nodeId})`);
}

/**
 * Формирует многострочный отчет по view/button/text дереву.
 */
function formatViewExportReport(packName, viewGraph) {
  const lines = [`Старт page-level экспорта. Pack: "${packName}"`, "Отчет по view:"];

  viewGraph.roots.forEach((root) => {
    appendViewExportReportLines(root, viewGraph, lines, 0);
  });

  return lines.join("\n");
}

/**
 * Добавляет одну строку отчета и рекурсивно обходит вложенные renderable children.
 */
function appendViewExportReportLines(descriptor, viewGraph, lines, depth) {
  const indent = "  ".repeat(depth);
  const childCount = getVisibleDirectChildren(descriptor.node).length;

  lines.push(`${indent}- view ${descriptor.name} : ${childCount} детей`);

  descriptor.childRenderableNodeIds.forEach((childNodeId) => {
    const childDescriptor = viewGraph.byNodeId.get(childNodeId);
    if (childDescriptor) {
      appendViewExportReportLines(childDescriptor, viewGraph, lines, depth + 1);
    }
  });
}

/**
 * ============================================================================
 * Assets Collection
 * ============================================================================
 *
 * Collects asset children from top-level renderable trees and copies them into an
 * assets* frame without changing the original hierarchy.
 */

/**
 * Собирает ассеты из top-level renderable деревьев в assets-frame.
 */
async function collectAssetsFromViewTrees() {
  const assetsFrameResult = getOrCreateAssetsFrame();
  const viewGraph = buildViewGraphFromCurrentPage();
  const sourceNodes = collectAssetSourceNodesFromViewGraph(viewGraph);
  const copiedNodes = copyAssetSourceNodesIntoAssetsFrame(sourceNodes, assetsFrameResult.frame);
  let aboutTextNode = null;

  try {
    aboutTextNode = await syncAssetsAboutText(assetsFrameResult.frame);
  } catch (error) {
    postUiLog(`Не удалось обновить assets-about: ${normalizeErrorMessage(error)}`, "warn");
  }

  figma.currentPage.selection = [assetsFrameResult.frame];
  figma.viewport.scrollAndZoomIntoView(
    aboutTextNode ? [aboutTextNode, assetsFrameResult.frame] : [assetsFrameResult.frame]
  );

  return {
    assetsFrameCreated: assetsFrameResult.created,
    assetsFrameName: assetsFrameResult.frame.name,
    assetsFrameId: assetsFrameResult.frame.id,
    viewRootsCount: viewGraph.roots.length,
    viewNodesCount: viewGraph.allViews.length,
    sourceNodesCount: sourceNodes.length,
    copiedNodesCount: copiedNodes.length,
  };
}

/**
 * Возвращает верхнеуровневый служебный node assets-about, если он уже есть.
 */
function findAssetsAboutNodeOnCurrentPage() {
  return figma.currentPage.children.find((node) => node.name === ASSETS_ABOUT_TEXT_NAME) || null;
}

/**
 * Создает или обновляет служебный текст над assets-frame.
 */
async function syncAssetsAboutText(assetsFrame) {
  const existingNode = findAssetsAboutNodeOnCurrentPage();
  if (existingNode) {
    existingNode.remove();
  }

  await figma.loadFontAsync(ASSETS_ABOUT_TEXT_FONT);

  const textNode = figma.createText();
  textNode.name = ASSETS_ABOUT_TEXT_NAME;
  textNode.textAutoResize = "WIDTH_AND_HEIGHT";
  textNode.fontName = ASSETS_ABOUT_TEXT_FONT;
  textNode.fontSize = ASSETS_ABOUT_TEXT_SIZE;
  textNode.characters = ASSETS_ABOUT_TEXT_CONTENT;

  figma.currentPage.appendChild(textNode);
  textNode.x = assetsFrame.x;
  textNode.y = assetsFrame.y - textNode.height - ASSETS_ABOUT_TEXT_GAP;

  return textNode;
}

/**
 * Возвращает существующий assets* фрейм или создает assets-core.
 */
function getOrCreateAssetsFrame() {
  const existingFrame = findFirstAssetsFrameOnCurrentPage();
  if (existingFrame) {
    return {
      created: false,
      frame: existingFrame,
    };
  }

  const lastFrame = findLastFrameOnCurrentPage();
  const frame = figma.createFrame();
  frame.name = ASSETS_CORE_FRAME_NAME;
  frame.resize(ASSETS_CORE_FRAME_WIDTH, ASSETS_CORE_FRAME_HEIGHT);

  if (lastFrame) {
    frame.x = lastFrame.x + lastFrame.width + ASSETS_CORE_FRAME_OFFSET_X;
    frame.y = lastFrame.y;
  } else {
    frame.x = 0;
    frame.y = 0;
  }

  figma.currentPage.appendChild(frame);

  return {
    created: true,
    frame,
  };
}

/**
 * Находит первый top-level FRAME с именем assets* на текущей странице.
 */
function findFirstAssetsFrameOnCurrentPage() {
  return figma.currentPage.children.find((node) => isAssetsFrameNode(node)) || null;
}

/**
 * Находит последний top-level FRAME на текущей странице по правой границе.
 */
function findLastFrameOnCurrentPage() {
  const frames = figma.currentPage.children.filter((node) => node.type === "FRAME");
  if (frames.length === 0) return null;

  return frames.reduce((lastFrame, frame) => {
    const lastRight = lastFrame.x + lastFrame.width;
    const frameRight = frame.x + frame.width;
    if (frameRight > lastRight) return frame;
    if (frameRight === lastRight && frame.y > lastFrame.y) return frame;
    return lastFrame;
  }, frames[0]);
}

/**
 * Строит graph renderable view/button/text узлов текущей страницы.
 */
function buildViewGraphFromCurrentPage() {
  const graph = {
    roots: [],
    allViews: [],
    byNodeId: new Map(),
  };
  const usedFunctionNames = new Set();

  figma.currentPage.children.forEach((node) => {
    collectRootViewDescriptorFromSubtree(node, graph, usedFunctionNames);
  });

  return graph;
}

/**
 * Ищет корневые renderable узлы вне assets* frame.
 */
function collectRootViewDescriptorFromSubtree(node, graph, usedFunctionNames) {
  if (!node || node.visible === false || isAssetsFrameNode(node)) return;

  if (isRenderableNode(node)) {
    const descriptor = appendViewDescriptorToGraph(node, null, graph, usedFunctionNames);
    if (descriptor) {
      graph.roots.push(descriptor);
    }
    return;
  }

  if (!hasChildren(node)) return;

  node.children.forEach((child) => {
    collectRootViewDescriptorFromSubtree(child, graph, usedFunctionNames);
  });
}

/**
 * Добавляет renderable node в graph и рекурсивно связывает direct child renderables.
 */
function appendViewDescriptorToGraph(node, parentDescriptor, graph, usedFunctionNames) {
  if (!node || node.visible === false) return null;

  const kind = getRenderableKind(node);
  if (!kind) return null;

  const existingDescriptor = graph.byNodeId.get(node.id);
  if (existingDescriptor) return existingDescriptor;

  const baseFunctionName = toCamelCase(node.name || node.id) || kind;
  const functionNameBase = kind === "text" ? `${baseFunctionName}TextView` : baseFunctionName;
  const baseText = kind === "text" ? String(node.characters || "") : undefined;
  const descriptor = {
    node,
    nodeId: node.id,
    name: node.name || node.id,
    kind,
    functionName: createUniqueFunctionName(functionNameBase, usedFunctionNames),
    dataName: "",
    parentNodeId: parentDescriptor ? parentDescriptor.nodeId : null,
    childRenderableNodeIds: [],
    baseText,
    textStyle: kind === "text" ? buildTextStyleSnapshotFromNode(node) : undefined,
  };

  descriptor.dataName = `${descriptor.functionName}Data`;

  graph.byNodeId.set(descriptor.nodeId, descriptor);
  graph.allViews.push(descriptor);

  getVisibleDirectChildren(node).forEach((child) => {
    if (!isRenderableNode(child)) return;

    const childDescriptor = appendViewDescriptorToGraph(child, descriptor, graph, usedFunctionNames);
    if (childDescriptor) {
      descriptor.childRenderableNodeIds.push(childDescriptor.nodeId);
    }
  });

  return descriptor;
}

/**
 * Возвращает видимых direct children, если узел поддерживает children.
 */
function getVisibleDirectChildren(node) {
  if (!hasChildren(node)) return [];
  return node.children.filter((child) => child && child.visible !== false);
}

/**
 * Собирает source nodes, которые должны быть представлены PNG assets.
 */
function collectAssetSourceNodesFromViewGraph(viewGraph) {
  const result = [];

  viewGraph.allViews.forEach((descriptor) => {
    getAssetSourceNodesForViewDescriptor(descriptor).forEach((sourceNode) => {
      result.push(sourceNode);
    });
  });

  return result;
}

/**
 * Возвращает asset nodes для одного renderable node.
 * Leaf button экспортируется как собственный single-asset view.
 */
function getAssetSourceNodesForViewDescriptor(descriptor) {
  const directAssetChildren = getVisibleDirectChildren(descriptor.node)
    .filter((child) => isAssetCandidateNode(child));

  if (directAssetChildren.length > 0) {
    return directAssetChildren;
  }

  if (shouldUseSelfAssetForViewDescriptor(descriptor, directAssetChildren)) {
    return [descriptor.node];
  }

  return [];
}

/**
 * Leaf button fallback: сам button node становится asset внутри своего view.
 */
function shouldUseSelfAssetForViewDescriptor(descriptor, directAssetChildren) {
  return descriptor.kind === "button" &&
    directAssetChildren.length === 0 &&
    descriptor.childRenderableNodeIds.length === 0;
}

/**
 * Копирует найденные source nodes в assets-frame на свободные места.
 */
function copyAssetSourceNodesIntoAssetsFrame(sourceNodes, assetsFrame) {
  const layoutState = createAssetsFrameLayoutState(assetsFrame);
  const existingNames = collectAssetsFrameChildNames(assetsFrame);
  const copiedNodes = [];

  sourceNodes.forEach((sourceNode) => {
    const sourceName = String(sourceNode && sourceNode.name || "").trim();
    if (sourceName && existingNames.has(sourceName)) {
      return;
    }

    const clone = sourceNode.clone();
    const sourceSize = readNodeSize(sourceNode);
    const position = getNextAssetsFramePosition(layoutState, sourceSize);

    assetsFrame.appendChild(clone);
    clone.x = position.x;
    clone.y = position.y;
    if (sourceName) {
      existingNames.add(sourceName);
    }
    copiedNodes.push(clone);
  });

  resizeAssetsFrameToFitLayout(assetsFrame, layoutState);
  return copiedNodes;
}

/**
 * Возвращает набор имен детей assets-frame.
 */
function collectAssetsFrameChildNames(assetsFrame) {
  const result = new Set();

  if (!hasChildren(assetsFrame)) {
    return result;
  }

  assetsFrame.children.forEach((child) => {
    if (child && child.name) {
      result.add(String(child.name).trim());
    }
  });

  return result;
}

/**
 * Создает состояние раскладки для поиска следующего свободного места.
 */
function createAssetsFrameLayoutState(assetsFrame) {
  const existingBottom = getAssetsFrameExistingChildrenBottom(assetsFrame);
  return {
    frameWidth: assetsFrame.width,
    cursorX: ASSETS_COLLECTION_MARGIN,
    cursorY: existingBottom > 0
      ? existingBottom + ASSETS_COLLECTION_GAP
      : ASSETS_COLLECTION_MARGIN,
    rowHeight: 0,
  };
}

/**
 * Возвращает нижнюю границу уже существующих детей assets-frame.
 */
function getAssetsFrameExistingChildrenBottom(assetsFrame) {
  if (!hasChildren(assetsFrame) || assetsFrame.children.length === 0) return 0;

  return assetsFrame.children.reduce((bottom, child) => {
    const size = readNodeSize(child);
    return Math.max(bottom, child.y + size.height);
  }, 0);
}

/**
 * Возвращает следующую позицию в assets-frame с переносом строк.
 */
function getNextAssetsFramePosition(layoutState, size) {
  const width = size.width;
  const height = size.height;
  const maxRight = layoutState.frameWidth - ASSETS_COLLECTION_MARGIN;

  if (layoutState.cursorX > ASSETS_COLLECTION_MARGIN && layoutState.cursorX + width > maxRight) {
    layoutState.cursorX = ASSETS_COLLECTION_MARGIN;
    layoutState.cursorY += layoutState.rowHeight + ASSETS_COLLECTION_GAP;
    layoutState.rowHeight = 0;
  }

  const position = {
    x: layoutState.cursorX,
    y: layoutState.cursorY,
  };

  layoutState.cursorX += width + ASSETS_COLLECTION_GAP;
  layoutState.rowHeight = Math.max(layoutState.rowHeight, height);

  return position;
}

/**
 * Увеличивает assets-frame по высоте, если новые копии вышли за текущий размер.
 */
function resizeAssetsFrameToFitLayout(assetsFrame, layoutState) {
  const requiredHeight = layoutState.cursorY + layoutState.rowHeight + ASSETS_COLLECTION_MARGIN;
  if (requiredHeight <= assetsFrame.height) return;
  assetsFrame.resize(assetsFrame.width, requiredHeight);
}

/**
 * Читает размер узла для раскладки внутри assets-frame.
 */
function readNodeSize(node) {
  if (typeof node.width === "number" && typeof node.height === "number") {
    return {
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
    };
  }

  const bounds = readExportBounds(node);
  return {
    width: Math.max(1, bounds ? bounds.width : 100),
    height: Math.max(1, bounds ? bounds.height : 100),
  };
}

/**
 * Читает актуальную геометрию узла, как она хранится в assets-frame.
 * Export использует этот снимок, чтобы учитывать ручные move/resize правки
 * в assets* frame, включая оптимизацию nine-slice текстур.
 */
function readAssetFrameNodeGeometry(node) {
  const size = readNodeSize(node);
  return {
    x: Math.round(typeof node.x === "number" ? node.x : 0),
    y: Math.round(typeof node.y === "number" ? node.y : 0),
    width: Math.round(size.width),
    height: Math.round(size.height),
  };
}

/**
 * Главный сценарий page-level экспорта View.
 */
async function runViewExportFromCurrentPage() {
  const assetsFrameResult = getOrCreateAssetsFrame();
  const viewGraph = buildViewGraphFromCurrentPage();

  if (viewGraph.roots.length === 0) {
    throw new Error('На текущей странице не найдено узлов, имя которых начинается с "view", "button" или "text"');
  }

  const packName = slugify(assetsFrameResult.frame.name || ASSETS_CORE_FRAME_NAME);
  postUiLog(formatViewExportReport(packName, viewGraph));

  const exportPlan = buildViewExportPlan({
    viewGraph,
    assetsFrame: assetsFrameResult.frame,
  });

  const files = [];
  const manifestItems = [];
  const skipped = [];
  const exportedAssetsByName = new Map();
  const unsafeNameWarnings = collectUnsafeNameWarningsForViews({
    views: buildViewWarningEntries(viewGraph),
    packSafeName: packName,
  });

  if (unsafeNameWarnings.length > 0) {
    postUiLog(formatUnsafeNameWarningText(unsafeNameWarnings), "warn");
  }

  for (let index = 0; index < exportPlan.assets.length; index += 1) {
    const asset = exportPlan.assets[index];

    figma.ui.postMessage({
      type: "EXPORT_PROGRESS",
      done: index,
      total: exportPlan.assets.length,
      currentName: asset.name,
    });

    try {
      const bytes = await asset.node.exportAsync(IMAGE_EXPORT_SETTINGS);
      const assetGeometry = readAssetFrameNodeGeometry(asset.node);
      files.push({ fileName: asset.fileName, bytes });
      exportedAssetsByName.set(asset.name, Object.assign({}, asset, {
        fileName: asset.fileName,
      }));
      manifestItems.push({
        nodeId: asset.node.id,
        name: asset.name,
        fileName: asset.fileName,
        x: assetGeometry.x,
        y: assetGeometry.y,
        width: assetGeometry.width,
        height: assetGeometry.height,
        kind: asset.kind,
        ninePadding: asset.ninePadding,
      });
    } catch (error) {
      skipped.push({
        nodeId: asset.node.id,
        name: asset.name,
        reason: normalizeErrorMessage(error),
      });
    }
  }

  figma.ui.postMessage({
    type: "EXPORT_PROGRESS",
    done: exportPlan.assets.length,
    total: exportPlan.assets.length,
    currentName: null,
  });

  if (files.length === 0) {
    throw new Error("Не удалось экспортировать ни одного PNG");
  }

  const manifest = {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    root: buildViewExportRootData(viewGraph.roots[0].node),
    items: manifestItems,
    views: buildManifestViews({
      viewGraph,
      exportedAssetsByName,
      skipped,
    }),
    skipped,
    warnings: {
      unsafeNames: unsafeNameWarnings,
      viewAssetLinks: exportPlan.warnings.viewAssetLinks,
    },
  };

  figma.ui.postMessage({
    type: "EXPORT_READY",
    packName,
    files,
    manifest,
  });

  postUiLog(`Экспорт завершен: ${files.length} PNG + manifest.json + views`);
}

/**
 * Legacy selection-based export, kept for reference but not used by the UI.
 */
async function runLegacyExportFromSelection() {
  const root = getSingleSelectedNode();
  postUiLog(`LEGACY export. Корневой узел: "${root.name || root.id}"`);
  const rootBounds = readAbsoluteBoundsOrThrow(root, "Корневой узел не имеет absoluteBoundingBox");
  const topChildren = getTopLevelChildren(root);

  if (topChildren.length === 0) {
    throw new Error("У выбранного узла нет верхних детей для экспорта");
  }

  const packName = getAssetsFramePackName();
  const unsafeNameWarnings = collectUnsafeNameWarnings({
    root,
    children: topChildren,
    rootSafeName: packName,
  });
  const usedFileBaseNames = new Set();
  const files = [];
  const manifestItems = [];
  const skipped = [];

  if (unsafeNameWarnings.length > 0) {
    postUiLog(formatUnsafeNameWarningText(unsafeNameWarnings), "warn");
  }

  for (let index = 0; index < topChildren.length; index += 1) {
    const child = topChildren[index];

    figma.ui.postMessage({
      type: "EXPORT_PROGRESS",
      done: index,
      total: topChildren.length,
      currentName: child.name || child.id,
    });

    const childBounds = readExportBounds(child);
    if (!childBounds) {
      skipped.push({
        nodeId: child.id,
        name: child.name || child.id,
        reason: "No absoluteRenderBounds/absoluteBoundingBox",
      });
      continue;
    }

    const baseName = makeUniqueFileBaseName({
      rawName: child.name || child.id,
      fallbackName: child.id,
      used: usedFileBaseNames,
    });
    const fileName = `${baseName}.png`;

    try {
      const bytes = await child.exportAsync(IMAGE_EXPORT_SETTINGS);
      files.push({ fileName, bytes });

      const nineInfo = detectNineSliceInfo(child.name || "");
      manifestItems.push({
        nodeId: child.id,
        name: child.name || child.id,
        fileName,
        x: Math.round(childBounds.x - rootBounds.x),
        y: Math.round(childBounds.y - rootBounds.y),
        width: Math.round(childBounds.width),
        height: Math.round(childBounds.height),
        kind: nineInfo.kind,
        ninePadding: nineInfo.ninePadding,
      });
    } catch (error) {
      skipped.push({
        nodeId: child.id,
        name: child.name || child.id,
        reason: normalizeErrorMessage(error),
      });
    }
  }

  figma.ui.postMessage({
    type: "EXPORT_PROGRESS",
    done: topChildren.length,
    total: topChildren.length,
    currentName: null,
  });

  if (files.length === 0) {
    throw new Error("Не удалось экспортировать ни одного PNG");
  }

  const manifest = {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    root: {
      nodeId: root.id,
      name: root.name || root.id,
      width: Math.round(rootBounds.width),
      height: Math.round(rootBounds.height),
    },
    items: manifestItems,
    skipped,
    warnings: {
      unsafeNames: unsafeNameWarnings,
    },
  };

  figma.ui.postMessage({
    type: "EXPORT_READY",
    packName,
    files,
    manifest,
  });

  postUiLog(`LEGACY export завершен: ${files.length} PNG + manifest.json`);
}

/**
 * Строит план page-level экспорта по renderable graph и assets-frame.
 */
function buildViewExportPlan(props) {
  const { viewGraph, assetsFrame } = props;
  const assetLayoutState = createAssetsFrameLayoutState(assetsFrame);
  const existingAssetsByName = collectAssetsFrameNodesByName(assetsFrame);
  const assets = [];
  const assetsByName = new Map();
  const usedFileBaseNames = new Set();
  const warnings = {
    viewAssetLinks: [],
  };

  viewGraph.allViews.forEach((descriptor) => {
    getAssetSourceNodesForViewDescriptor(descriptor).forEach((sourceNode) => {
      addAssetSourceNodeToExportPlan({
        sourceNode,
        viewDescriptor: descriptor,
        assetsFrame,
        assetLayoutState,
        existingAssetsByName,
        assets,
        assetsByName,
        usedFileBaseNames,
        warnings,
      });
    });
  });

  resizeAssetsFrameToFitLayout(assetsFrame, assetLayoutState);

  return {
    assets,
    warnings,
  };
}

/**
 * Добавляет один PNG asset source в export plan с дедупликацией по имени.
 */
function addAssetSourceNodeToExportPlan(props) {
  const {
    sourceNode,
    viewDescriptor,
    assetsFrame,
    assetLayoutState,
    existingAssetsByName,
    assets,
    assetsByName,
    usedFileBaseNames,
    warnings,
  } = props;
  const assetName = String(sourceNode.name || sourceNode.id || "").trim();
  if (!assetName) return;

  const assetBounds = readExportBounds(sourceNode);
  if (!assetBounds) {
    warnings.viewAssetLinks.push({
      viewNodeId: viewDescriptor.nodeId,
      viewName: viewDescriptor.name,
      childNodeId: sourceNode.id,
      childName: assetName,
      reason: "No absoluteRenderBounds/absoluteBoundingBox",
    });
    return;
  }

  const existingAssetSource = existingAssetsByName.get(assetName);
  const assetSource = existingAssetSource || sourceNode.clone();

  if (!existingAssetSource) {
    const sourceSize = readNodeSize(sourceNode);
    const position = getNextAssetsFramePosition(assetLayoutState, sourceSize);
    assetsFrame.appendChild(assetSource);
    assetSource.x = position.x;
    assetSource.y = position.y;
    existingAssetsByName.set(assetName, assetSource);
  }

  if (assetsByName.has(assetName)) {
    return;
  }

  const baseName = makeUniqueFileBaseName({
    rawName: assetName,
    fallbackName: sourceNode.id,
    used: usedFileBaseNames,
  });
  const fileName = `${baseName}.png`;
  const nineInfo = detectNineSliceInfo(assetName);

  const assetEntry = {
    name: assetName,
    node: assetSource,
    fileName,
    kind: nineInfo.kind,
    ninePadding: nineInfo.ninePadding,
  };

  assets.push(assetEntry);
  assetsByName.set(assetName, assetEntry);
}

/**
 * Строит минимальный список view/child имен для warning-логики.
 */
function buildViewWarningEntries(viewGraph) {
  return viewGraph.allViews.map((descriptor) => ({
    nodeId: descriptor.nodeId,
    name: descriptor.name,
    children: getAssetSourceNodesForViewDescriptor(descriptor).map((sourceNode) => ({
      nodeId: sourceNode.id,
      name: sourceNode.name || sourceNode.id,
    })),
  }));
}

/**
 * Возвращает карты детей assets-frame по имени.
 */
function collectAssetsFrameNodesByName(assetsFrame) {
  const result = new Map();

  if (!hasChildren(assetsFrame)) {
    return result;
  }

  assetsFrame.children.forEach((child) => {
    if (!child || !child.name) return;
    result.set(String(child.name).trim(), child);
  });

  return result;
}

/**
 * Строит data для root renderable node в manifest.
 */
function buildViewExportRootData(viewNode) {
  const bounds = readViewBoundsOrThrow(viewNode, "Renderable node не имеет bounds");
  return {
    nodeId: viewNode.id,
    name: viewNode.name || viewNode.id,
    kind: isRenderableTextNode(viewNode) ? "text" : getRenderableKind(viewNode) || "view",
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
}

/**
 * Строит manifest.views из page-level view/button/text graph.
 */
function buildManifestViews(props) {
  const { viewGraph, exportedAssetsByName, skipped } = props;
  const views = [];

  viewGraph.allViews.forEach((viewDescriptor) => {
    const viewNode = viewDescriptor.node;
    const viewBounds = readViewBounds(viewNode);
    if (!viewBounds) {
      skipped.push({
        nodeId: viewNode.id,
        name: viewNode.name || viewNode.id,
        reason: "Renderable node has no bounds",
      });
      return;
    }

    const children = buildManifestChildrenForView({
      viewDescriptor,
      viewBounds,
      viewGraph,
      exportedAssetsByName,
      skipped,
    });

    views.push({
      nodeId: viewDescriptor.nodeId,
      name: viewDescriptor.name,
      functionName: viewDescriptor.functionName,
      dataName: viewDescriptor.dataName,
      kind: viewDescriptor.kind,
      button: viewDescriptor.kind === "button" ? true : undefined,
      x: Math.round(viewBounds.x),
      y: Math.round(viewBounds.y),
      width: Math.round(viewBounds.width),
      height: Math.round(viewBounds.height),
      baseText: viewDescriptor.kind === "text" ? viewDescriptor.baseText : undefined,
      textStyle: viewDescriptor.kind === "text" ? viewDescriptor.textStyle : undefined,
      children,
    });
  });

  return views;
}

/**
 * Строит ordered children для одного manifest renderable.
 */
function buildManifestChildrenForView(props) {
  const {
    viewDescriptor,
    viewBounds,
    viewGraph,
    exportedAssetsByName,
    skipped,
  } = props;
  const children = [];
  const directChildren = getVisibleDirectChildren(viewDescriptor.node);
  const directAssetChildren = directChildren.filter((child) => isAssetCandidateNode(child));

  directChildren.forEach((child) => {
    if (isRenderableNode(child)) {
      addManifestViewChild({
        children,
        child,
        parentBounds: viewBounds,
        viewGraph,
        skipped,
      });
      return;
    }

    if (isAssetCandidateNode(child)) {
      addManifestAssetChild({
        children,
        sourceNode: child,
        parentBounds: viewBounds,
        exportedAssetsByName,
        skipped,
      });
    }
  });

  if (shouldUseSelfAssetForViewDescriptor(viewDescriptor, directAssetChildren)) {
    addManifestAssetChild({
      children,
      sourceNode: viewDescriptor.node,
      parentBounds: viewBounds,
      exportedAssetsByName,
      skipped,
    });
  }

  return children;
}

/**
 * Добавляет asset child в manifest view, если asset успешно экспортирован.
 */
function addManifestAssetChild(props) {
  const { children, sourceNode, parentBounds, exportedAssetsByName, skipped } = props;
  const childName = String(sourceNode.name || sourceNode.id || "").trim();
  const assetEntry = exportedAssetsByName.get(childName);
  if (!assetEntry) return;

  const childBounds = readExportBounds(sourceNode);
  if (!childBounds) {
    skipped.push({
      nodeId: sourceNode.id,
      name: childName,
      reason: "No absoluteRenderBounds/absoluteBoundingBox",
    });
    return;
  }

  children.push({
    type: "asset",
    nodeId: sourceNode.id,
    name: childName,
    assetFileName: assetEntry.fileName,
    x: Math.round(childBounds.x - parentBounds.x),
    y: Math.round(childBounds.y - parentBounds.y),
    width: Math.round(childBounds.width),
    height: Math.round(childBounds.height),
    kind: assetEntry.kind,
    ninePadding: assetEntry.ninePadding,
  });
}

/**
 * Добавляет nested renderable child в manifest view.
 */
function addManifestViewChild(props) {
  const { children, child, parentBounds, viewGraph, skipped } = props;
  const childDescriptor = viewGraph.byNodeId.get(child.id);
  if (!childDescriptor) return;

  const childBounds = readViewBounds(child);
  if (!childBounds) {
    skipped.push({
      nodeId: child.id,
      name: child.name || child.id,
      reason: "Renderable node has no bounds",
    });
    return;
  }

  if (childDescriptor.kind === "text") {
    children.push({
      type: "text",
      nodeId: child.id,
      name: child.name || child.id,
      textNodeId: childDescriptor.nodeId,
      textFunctionName: childDescriptor.functionName,
      textDataName: childDescriptor.dataName,
      x: Math.round(childBounds.x - parentBounds.x),
      y: Math.round(childBounds.y - parentBounds.y),
      width: Math.round(childBounds.width),
      height: Math.round(childBounds.height),
    });
    return;
  }

  children.push({
    type: "view",
    nodeId: child.id,
    name: child.name || child.id,
    viewNodeId: childDescriptor.nodeId,
    viewFunctionName: childDescriptor.functionName,
    viewDataName: childDescriptor.dataName,
    x: Math.round(childBounds.x - parentBounds.x),
    y: Math.round(childBounds.y - parentBounds.y),
    width: Math.round(childBounds.width),
    height: Math.round(childBounds.height),
  });
}

/**
 * Создает уникальное имя view-функции.
 */
function createUniqueFunctionName(baseName, used) {
  let next = baseName || "view";
  let suffix = 2;

  while (used.has(next)) {
    next = `${baseName || "view"}${suffix}`;
    suffix += 1;
  }

  used.add(next);
  return next;
}

/**
 * Собирает warning по несовпадающим View child / asset ссылкам.
 */
function collectUnsafeNameWarningsForViews(props) {
  const { views, packSafeName } = props;
  const warnings = [];

  if (!isSafeFileBaseName(packSafeName)) {
    warnings.push({
      role: "pack",
      nodeId: null,
      name: packSafeName,
      safeName: slugify(packSafeName),
      invalidCharacters: collectUnsafeFileNameCharacters(packSafeName),
    });
  }

  views.forEach((view) => {
    const warning = createUnsafeNameWarning({
      node: {
        id: view.nodeId,
        name: view.name,
      },
      role: "view",
      safeName: slugify(view.name || view.nodeId),
    });

    if (warning) {
      warnings.push(warning);
    }

    view.children.forEach((child) => {
      const childWarning = createUnsafeNameWarning({
        node: {
          id: child.nodeId,
          name: child.name,
        },
        role: "child",
        safeName: slugify(child.name || child.nodeId),
      });

      if (childWarning) {
        warnings.push(childWarning);
      }
    });
  });

  return warnings;
}

/**
 * Преобразует имя в camelCase для generated view-функций.
 */
function toCamelCase(input) {
  const parts = String(input || "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "";

  const [first, ...rest] = parts;
  const head = first.charAt(0).toLowerCase() + first.slice(1);
  const result = [head, ...rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1))].join("");
  return /^[0-9]/.test(result) ? `n${result}` : result;
}

/**
 * Возвращает безопасный packName из имени первого assets* фрейма на странице.
 */
function getAssetsFramePackName() {
  const assetsFrame = findFirstAssetsFrameOnCurrentPage();
  if (!assetsFrame) {
    throw new Error('На текущей странице не найден frame с именем "assets*" для packName');
  }

  return slugify(assetsFrame.name || ASSETS_CORE_FRAME_NAME);
}

/**
 * Возвращает один выделенный узел и валидирует, что он ровно один.
 */
function getSingleSelectedNode() {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    throw new Error("Выберите ровно один корневой узел");
  }

  const root = selection[0];
  if (!hasChildren(root)) {
    throw new Error("Выбранный узел не поддерживает children");
  }

  return root;
}

/**
 * Возвращает диагностический статус текущего selection без запуска экспорта.
 */
function getSelectionDiagnostic() {
  const selection = figma.currentPage.selection;

  if (selection.length !== 1) {
    return {
      ok: false,
      message: "Выберите ровно один корневой узел",
      selectionCount: selection.length,
    };
  }

  const root = selection[0];
  if (!hasChildren(root)) {
    return {
      ok: false,
      message: "Выбранный узел не поддерживает children",
      selectionCount: selection.length,
      rootName: root.name || root.id,
      rootNodeId: root.id,
    };
  }

  const visibleTopChildren = getTopLevelChildren(root);
  return {
    ok: visibleTopChildren.length > 0,
    message: visibleTopChildren.length > 0
      ? `Selection готов: "${root.name || root.id}", видимых верхних детей: ${visibleTopChildren.length}`
      : "У выбранного узла нет видимых верхних детей для экспорта",
    selectionCount: selection.length,
    rootName: root.name || root.id,
    rootNodeId: root.id,
    visibleTopChildrenCount: visibleTopChildren.length,
  };
}

/**
 * Отправляет диагностику selection в UI.
 */
function postSelectionDiagnostic() {
  figma.ui.postMessage({
    type: "SELECTION_DIAGNOSTIC",
    diagnostic: getSelectionDiagnostic(),
  });
}

/**
 * Возвращает только верхних видимых детей корневого узла.
 */
function getTopLevelChildren(root) {
  return root.children.filter((child) => child.visible !== false);
}

/**
 * Проверяет, что узел поддерживает children.
 */
function hasChildren(node) {
  return "children" in node;
}

/**
 * Читает absoluteBoundingBox без выброса ошибки.
 */
function readAbsoluteBounds(node) {
  if (!node || !node.absoluteBoundingBox) return null;
  return node.absoluteBoundingBox;
}

/**
 * Читает bounds для renderable контейнера.
 */
function readViewBounds(node) {
  return readAbsoluteBounds(node) || readExportBounds(node);
}

/**
 * Читает bounds для renderable node или бросает ошибку, если их нет.
 */
function readViewBoundsOrThrow(node, errorMessage) {
  const bounds = readViewBounds(node);
  if (!bounds) throw new Error(errorMessage);
  return bounds;
}

/**
 * Возвращает snapshot текстового стиля для generated Phaser TextStyle.
 */
function buildTextStyleSnapshotFromNode(node) {
  const style = {};
  const fontName = node && node.fontName;

  if (fontName && fontName !== figma.mixed && typeof fontName.family === "string" && fontName.family) {
    style.fontFamily = fontName.family;
  }

  const fontSize = node && node.fontSize;
  if (typeof fontSize === "number" && Number.isFinite(fontSize)) {
    style.fontSize = Math.round(fontSize);
  }

  const fillColor = readFirstSolidPaintColor(node && node.fills);
  if (fillColor) {
    style.color = fillColor;
  }

  const strokeWeight = node && node.strokeWeight;
  if (typeof strokeWeight === "number" && Number.isFinite(strokeWeight)) {
    style.strokeThickness = Math.round(strokeWeight);
  }

  const strokeColor = readFirstSolidPaintColor(node && node.strokes);
  if (strokeColor) {
    style.stroke = strokeColor;
  }

  return style;
}

/**
 * Возвращает первый solid color в массиве paints, если он есть.
 */
function readFirstSolidPaintColor(paints) {
  if (!Array.isArray(paints)) return null;

  for (const paint of paints) {
    if (!paint || paint.visible === false || paint.type !== "SOLID" || !paint.color) {
      continue;
    }

    const opacity = typeof paint.opacity === "number" ? paint.opacity : 1;
    return rgbaToCssColor(paint.color.r, paint.color.g, paint.color.b, opacity);
  }

  return null;
}

/**
 * Преобразует Figma rgba в CSS color string.
 */
function rgbaToCssColor(r, g, b, a = 1) {
  const to255 = (value) => Math.max(0, Math.min(255, Math.round(Number(value || 0) * 255)));
  const red = to255(r);
  const green = to255(g);
  const blue = to255(b);
  const alpha = Math.max(0, Math.min(1, Number(a)));

  if (alpha < 1) {
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  const hex = [red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return `#${hex}`;
}

/**
 * Возвращает границы, максимально близкие к фактическому рендеру.
 * Сначала берем absoluteRenderBounds (включает внешнюю обводку/эффекты),
 * если его нет — fallback на absoluteBoundingBox.
 */
function readExportBounds(node) {
  if (!node) return null;
  if (node.absoluteRenderBounds) return node.absoluteRenderBounds;
  if (node.absoluteBoundingBox) return node.absoluteBoundingBox;
  return null;
}

/**
 * Читает absoluteBoundingBox и бросает ошибку, если его нет.
 */
function readAbsoluteBoundsOrThrow(node, errorMessage) {
  const bounds = readAbsoluteBounds(node);
  if (!bounds) throw new Error(errorMessage);
  return bounds;
}

/**
 * Генерирует безопасное и уникальное base-имя файла без расширения.
 */
function makeUniqueFileBaseName(props) {
  const { rawName, fallbackName, used } = props;
  const base = slugify(rawName || fallbackName || "item");
  let next = base;
  let suffix = 2;

  while (used.has(next)) {
    next = `${base}-${suffix}`;
    suffix += 1;
  }

  used.add(next);
  return next;
}

/**
 * Собирает предупреждения по исходным именам, которые нельзя безопасно использовать как file names.
 */
function collectUnsafeNameWarnings(props) {
  const { root, children, rootSafeName } = props;
  const warnings = [];
  const rootWarning = createUnsafeNameWarning({
    node: root,
    role: "root",
    safeName: rootSafeName,
  });

  if (rootWarning) {
    warnings.push(rootWarning);
  }

  children.forEach((child) => {
    const warning = createUnsafeNameWarning({
      node: child,
      role: "child",
      safeName: slugify(child.name || child.id),
    });

    if (warning) {
      warnings.push(warning);
    }
  });

  return warnings;
}

/**
 * Создает предупреждение по одному узлу или возвращает null, если имя безопасно.
 */
function createUnsafeNameWarning(props) {
  const { node, role, safeName } = props;
  const name = String((node && (node.name || node.id)) || "");
  if (isSafeFileBaseName(name)) return null;

  return {
    role,
    nodeId: node && node.id,
    name,
    safeName,
    invalidCharacters: collectUnsafeFileNameCharacters(name),
  };
}

/**
 * Проверяет строгий формат имени файла: латиница, цифры, точка, underscore и дефис.
 */
function isSafeFileBaseName(input) {
  const value = String(input || "");
  return value.length > 0 && SAFE_FILE_BASE_NAME_RE.test(value);
}

/**
 * Возвращает уникальный список запрещенных символов для отображения в предупреждении.
 */
function collectUnsafeFileNameCharacters(input) {
  const seen = new Set();
  const result = [];

  Array.from(String(input || "")).forEach((char) => {
    if (SAFE_FILE_BASE_NAME_CHAR_RE.test(char) || seen.has(char)) return;
    seen.add(char);
    result.push(char);
  });

  return result;
}

/**
 * Формирует компактный текст предупреждения для UI-лога.
 */
function formatUnsafeNameWarningText(warnings) {
  const lines = warnings.map((warning) => {
    const invalid = warning.invalidCharacters
      .map((char) => JSON.stringify(char))
      .join(", ");
    return `- ${warning.role} "${warning.name}" -> "${warning.safeName}" (${invalid})`;
  });

  return [
    "Найдены небезопасные имена для файлов. Разрешены только A-Z, a-z, 0-9, точка, underscore и дефис:",
    ...lines,
  ].join("\n");
}

/**
 * Преобразует строку в безопасный slug для файлов.
 */
function slugify(input) {
  const value = String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return value || "item";
}

/**
 * Определяет, является ли узел nine-slice по имени вида "...nine.20".
 */
function detectNineSliceInfo(rawName) {
  const match = String(rawName || "").trim().match(/(?:^|[._-])nine\.(\d+)$/i);
  if (!match) {
    return {
      kind: "image",
      ninePadding: undefined,
    };
  }

  const padding = Number(match[1]);
  if (!Number.isFinite(padding)) {
    return {
      kind: "image",
      ninePadding: undefined,
    };
  }

  return {
    kind: "nine",
    ninePadding: padding,
  };
}

/**
 * Приводит ошибку к компактному тексту для UI/notify.
 */
function normalizeErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Отправляет строку лога в UI, чтобы не использовать всплывающие notify.
 */
function postUiLog(message, level = "info") {
  figma.ui.postMessage({
    type: "LOG",
    level,
    message: String(message || ""),
    atIso: new Date().toISOString(),
  });
}

/**
 * Обработка сообщений от UI.
 */
figma.ui.onmessage = async (msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "GET_SETTINGS") {
    try {
      const settings = await figma.clientStorage.getAsync(SETTINGS_STORAGE_KEY);
      figma.ui.postMessage({
        type: "SETTINGS_LOADED",
        settings: settings && typeof settings === "object" ? settings : {},
      });
    } catch (error) {
      const message = normalizeErrorMessage(error);
      postUiLog(`Не удалось прочитать настройки: ${message}`, "error");
      figma.ui.postMessage({ type: "SETTINGS_LOAD_FAILED", message });
    }
    return;
  }

  if (msg.type === "SAVE_SETTINGS") {
    try {
      const settings = msg.settings && typeof msg.settings === "object" ? msg.settings : {};
      await figma.clientStorage.setAsync(SETTINGS_STORAGE_KEY, settings);
      figma.ui.postMessage({ type: "SETTINGS_SAVED" });
    } catch (error) {
      const message = normalizeErrorMessage(error);
      postUiLog(`Не удалось сохранить настройки: ${message}`, "error");
      figma.ui.postMessage({ type: "SETTINGS_SAVE_FAILED", message });
    }
    return;
  }

  if (msg.type === "GET_SELECTION_DIAGNOSTIC") {
    postPageState();
    return;
  }

  if (msg.type === "GET_PAGE_STATE") {
    postPageState();
    return;
  }

  if (msg.type === "GET_CURRENT_PAGE_SCAN_DIAGNOSTIC") {
    postPageState();
    return;
  }

  if (msg.type === "COLLECT_ASSETS" || msg.type === "CREATE_ASSETS_FRAME") {
    try {
      const result = await collectAssetsFromViewTrees();
      postUiLog(
        `Ассеты собраны: view/button/text корней ${result.viewRootsCount}, view/button/text узлов ${result.viewNodesCount}, найдено ${result.sourceNodesCount}, скопировано ${result.copiedNodesCount} в "${result.assetsFrameName}"`
      );
      figma.ui.postMessage({
        type: "ASSETS_COLLECTION_DONE",
        result,
      });
      postPageState();
    } catch (error) {
      const message = normalizeErrorMessage(error);
      postUiLog(`Не удалось собрать ассеты: ${message}`, "error");
      figma.ui.postMessage({ type: "ASSETS_COLLECTION_FAILED", message });
    }
    return;
  }

  if (msg.type === "EXPORT_TO_PROJECT") {
    postUiLog("Запуск page-level экспорта по кнопке UI");
    runViewExportFromCurrentPage().catch((error) => {
      const message = normalizeErrorMessage(error);
      postUiLog(message, "error");
      figma.ui.postMessage({ type: "EXPORT_FAILED", message });
    });
    return;
  }

  if (msg.type === "EXPORT_DONE") {
    postUiLog("UI сообщил об успешной синхронизации файлов");
    return;
  }

  if (msg.type === "EXPORT_ERROR") {
    const message = String(msg.message || "Неизвестная ошибка UI");
    postUiLog(`Ошибка UI: ${message}`, "error");
    return;
  }

};
