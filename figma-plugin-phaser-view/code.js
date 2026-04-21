/**
 * Figma plugin main thread.
 *
 * Задача:
 * - взять 1 выделенный узел;
 * - экспортировать только его верхних детей в PNG;
 * - собрать manifest.json с координатами/размерами;
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
 * Startup-only diagnostics for finding Figma nodes that can become export roots
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

    if (isViewNamedNode(node)) {
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
 * Проверяет, начинается ли имя любого объекта с "view".
 */
function isViewNamedNode(node) {
  return startsWithIgnoreCase(node && node.name, "view");
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
    `Объекты view*: ${diagnostic.viewNodes.length}`,
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
 * ============================================================================
 * Assets Collection
 * ============================================================================
 *
 * Collects non-view children from top-level view* trees and copies them into an
 * assets* frame without changing the original view hierarchy.
 */

/**
 * Собирает ассеты из top-level view* деревьев в assets-frame.
 */
function collectAssetsFromViewTrees() {
  const assetsFrameResult = getOrCreateAssetsFrame();
  const viewRoots = getTopLevelViewNodes();
  const sourceNodes = collectAssetSourceNodesFromViewRoots(viewRoots);
  const copiedNodes = copyAssetSourceNodesIntoAssetsFrame(sourceNodes, assetsFrameResult.frame);

  figma.currentPage.selection = [assetsFrameResult.frame];
  figma.viewport.scrollAndZoomIntoView([assetsFrameResult.frame]);

  return {
    assetsFrameCreated: assetsFrameResult.created,
    assetsFrameName: assetsFrameResult.frame.name,
    assetsFrameId: assetsFrameResult.frame.id,
    viewRootsCount: viewRoots.length,
    sourceNodesCount: sourceNodes.length,
    copiedNodesCount: copiedNodes.length,
  };
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
 * Возвращает первые найденные view* узлы на странице, исключая assets* фреймы.
 */
function getTopLevelViewNodes() {
  const result = [];

  figma.currentPage.children.forEach((node) => {
    collectTopLevelViewNodesFromSubtree(node, result);
  });

  return result;
}

/**
 * Ищет view* корни внутри top-level поддерева страницы.
 */
function collectTopLevelViewNodesFromSubtree(node, result) {
  if (isAssetsFrameNode(node)) return;

  if (isViewNamedNode(node)) {
    result.push(node);
    return;
  }

  if (!hasChildren(node)) return;

  node.children.forEach((child) => {
    collectTopLevelViewNodesFromSubtree(child, result);
  });
}

/**
 * Собирает все non-view узлы из view* деревьев по правилу верхнего уровня.
 */
function collectAssetSourceNodesFromViewRoots(viewRoots) {
  const result = [];

  viewRoots.forEach((viewRoot) => {
    collectAssetSourceNodesFromViewNode(viewRoot, result);
  });

  return result;
}

/**
 * Исследует только top-level детей view-узла и углубляется только в view* детей.
 */
function collectAssetSourceNodesFromViewNode(viewNode, result) {
  if (!hasChildren(viewNode)) return;

  viewNode.children.forEach((child) => {
    if (isViewNamedNode(child)) {
      collectAssetSourceNodesFromViewNode(child, result);
      return;
    }

    result.push(child);
  });
}

/**
 * Копирует найденные source nodes в assets-frame на свободные места.
 */
function copyAssetSourceNodesIntoAssetsFrame(sourceNodes, assetsFrame) {
  const layoutState = createAssetsFrameLayoutState(assetsFrame);
  const copiedNodes = [];

  sourceNodes.forEach((sourceNode) => {
    const clone = sourceNode.clone();
    const sourceSize = readNodeSize(sourceNode);
    const position = getNextAssetsFramePosition(layoutState, sourceSize);

    assetsFrame.appendChild(clone);
    clone.x = position.x;
    clone.y = position.y;
    copiedNodes.push(clone);
  });

  resizeAssetsFrameToFitLayout(assetsFrame, layoutState);
  return copiedNodes;
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
 * Главный сценарий экспорта для одного выделенного корневого узла.
 */
async function runExportFromSelection() {
  const root = getSingleSelectedNode();
  postUiLog(`Старт экспорта. Корневой узел: "${root.name || root.id}"`);
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

  postUiLog(`Экспорт завершен: ${files.length} PNG + manifest.json`);
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
      const result = collectAssetsFromViewTrees();
      postUiLog(
        `Ассеты собраны: view* корней ${result.viewRootsCount}, найдено ${result.sourceNodesCount}, скопировано ${result.copiedNodesCount} в "${result.assetsFrameName}"`
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
    postUiLog("Запуск экспорта по кнопке UI");
    runExportFromSelection().catch((error) => {
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
