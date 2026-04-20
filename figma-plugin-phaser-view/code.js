/**
 * Figma plugin main thread.
 *
 * Задача:
 * - взять 1 выделенный узел;
 * - экспортировать только его верхних детей в PNG;
 * - собрать manifest.json с координатами/размерами;
 * - отправить в UI данные для скачивания ZIP.
 */

const UI_WIDTH = 520;
const UI_HEIGHT = 360;

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

// Сразу запускаем экспорт по текущему выделению.
runExportFromSelection().catch((error) => {
  const message = normalizeErrorMessage(error);
  postUiLog(message, "error");
  figma.ui.postMessage({ type: "EXPORT_FAILED", message });
});

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

  const packName = slugify(root.name || "pack");
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
figma.ui.onmessage = (msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "RETRY_EXPORT") {
    postUiLog("Повторный запуск экспорта");
    runExportFromSelection().catch((error) => {
      const message = normalizeErrorMessage(error);
      postUiLog(message, "error");
      figma.ui.postMessage({ type: "EXPORT_FAILED", message });
    });
    return;
  }

  if (msg.type === "EXPORT_DONE") {
    postUiLog("UI сообщил об успешной сборке ZIP");
    return;
  }

  if (msg.type === "EXPORT_ERROR") {
    const message = String(msg.message || "Неизвестная ошибка UI");
    postUiLog(`Ошибка UI: ${message}`, "error");
    return;
  }

  if (msg.type === "CLOSE") {
    figma.closePlugin();
  }
};
