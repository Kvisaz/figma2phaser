/* eslint-disable */
/**
 * figma2phaser.js
 *
 * Это автономный pipeline-скрипт для переноса ассетов из Figma в Phaser:
 * 1) читает packs из figma2phaser.config.js;
 * 2) для каждого pack запрашивает целевой Figma node и берет только верхних детей;
 * 3) экспортирует этих детей в PNG во временную папку;
 * 4) собирает PNG в Phaser-атлас (png + json);
 * 5) генерирует autoFigmaAssets.ts и TS-файлы сцен/хелперов для предпросмотра.
 *
 * Скрипт запускается из корня проекта через:
 * npm run figma
 *
 * Подробности и описание полей конфига намеренно вынесены в:
 * - figma2phaser.config.js (комментарии у полей)
 * - figma2phaser.config.md
 *
 * Требования к TexturePacker:
 * - в проекте должен быть установлен пакет free-tex-packer-core;
 * - опции упаковки задаются через config.texturePackerOptions;
 * - скрипт пишет atlas png/json в папку atlasOutputDir.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const texturePacker = require("free-tex-packer-core");
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_CONFIG = Object.freeze({
  // Минимальный интервал между запусками скрипта (мс).
  runCooldownMs: 60_000,
  // Файл в ./tmp с заметками о предыдущем запуске (время, статус, ошибка).
  runMetaPath: "./tmp/figma2phaser-last-run.json",
  // Задержка между обработкой pack (мс). Для первого pack задержка не применяется.
  figmaParseDelay: 15_000,
  // Временная папка, куда складываются PNG из Figma перед упаковкой.
  tmpDir: "./tmp",
  // Папка итоговых atlas-файлов (png/json), обычно внутри public.
  atlasOutputDir: "./public/assets/atlases",
  // Куда писать автогенерируемый файл ассетов.
  autoAssetsOutputPath: "./src/autoFigmaAssets.ts",
  // Имя экспортируемой константы в autoAssetsOutputPath.
  autoAssetsExportName: "autoFigmaAssets",
  // Куда генерировать TS-файлы pack-сцен и add-функций.
  figmaAssetsSceneDir: "./src/scenes/shared/figmaAssets",
  // Дефолтные опции упаковки atlas через free-tex-packer-core.
  texturePackerOptions: {
    fixedSize: false,
    padding: 2,
    allowRotation: false,
    detectIdentical: false,
    allowTrim: false,
    exporter: "Phaser3",
    packer: "MaxRectsPacker",
  },
  // Список pack по умолчанию пустой; реальные pack обычно приходят из figma2phaser.config.js.
  packs: [],
});

/** Запускает полный pipeline от чтения конфига до генерации файлов. */
async function main() {
  let runMetaPathAbs = "";
  let runStarted = false;
  let runStartedAtMs = 0;
  let runCooldownMs = DEFAULT_CONFIG.runCooldownMs;
  let runPackNames = [];

  try {
    const config = loadConfig();
    const resolved = resolveConfigPaths(config);
    runMetaPathAbs = resolved.runMetaPathAbs;
    runCooldownMs = resolved.runCooldownMs;
    runPackNames = resolved.packs.map((pack) => pack.packName);

    await ensureDir(path.dirname(runMetaPathAbs));
    const previousRunMeta = await readRunMeta(runMetaPathAbs);
    assertRunCooldown({
      previousRunMeta,
      runCooldownMs: resolved.runCooldownMs,
      nowMs: Date.now(),
    });

    runStartedAtMs = Date.now();
    runStarted = true;
    await writeRunMeta({
      runMetaPathAbs,
      runMeta: {
        status: "started",
        runCooldownMs: resolved.runCooldownMs,
        startedAtMs: runStartedAtMs,
        startedAtIso: new Date(runStartedAtMs).toISOString(),
        finishedAtMs: null,
        finishedAtIso: null,
        durationMs: null,
        packNames: runPackNames,
        errorMessage: null,
      },
    });

    loadDotEnv(path.resolve(PROJECT_ROOT, ".env"));
    const figmaToken = readFigmaTokenFromEnv();
    await ensureDir(resolved.tmpDirAbs);
    await ensureDir(resolved.atlasOutputDirAbs);
    await ensureDir(resolved.figmaAssetsSceneDirAbs);

    if (resolved.packs.length === 0) {
      throw new Error("No packs in figma2phaser.config.js");
    }

    const packResults = [];
    for (let index = 0; index < resolved.packs.length; index += 1) {
      const pack = resolved.packs[index];
      if (index > 0 && resolved.figmaParseDelay > 0) {
        console.log(`Wait ${resolved.figmaParseDelay} ms before pack "${pack.packName}"...`);
        await waitMs(resolved.figmaParseDelay);
      }

      console.log(`\nProcess pack "${pack.packName}"`);
      const packResult = await processPack({
        pack,
        figmaToken,
        tmpDirAbs: resolved.tmpDirAbs,
        atlasOutputDirAbs: resolved.atlasOutputDirAbs,
        texturePackerOptions: resolved.texturePackerOptions,
      });
      packResults.push(packResult);
    }

    const autoAssets = buildAutoFigmaAssets({
      packResults,
    });

    await writeAutoAssetsFile({
      autoAssets,
      outputPathAbs: resolved.autoAssetsOutputPathAbs,
      exportName: resolved.autoAssetsExportName,
    });

    await writePackCodeFiles({
      autoAssets,
      packResults,
      sceneDirAbs: resolved.figmaAssetsSceneDirAbs,
      autoAssetsPathAbs: resolved.autoAssetsOutputPathAbs,
      autoAssetsExportName: resolved.autoAssetsExportName,
    });

    const runFinishedAtMs = Date.now();
    await writeRunMeta({
      runMetaPathAbs,
      runMeta: {
        status: "success",
        runCooldownMs,
        startedAtMs: runStartedAtMs,
        startedAtIso: new Date(runStartedAtMs).toISOString(),
        finishedAtMs: runFinishedAtMs,
        finishedAtIso: new Date(runFinishedAtMs).toISOString(),
        durationMs: runFinishedAtMs - runStartedAtMs,
        packNames: runPackNames,
        errorMessage: null,
      },
    });

    console.log("\nfigma2phaser completed");
  } catch (error) {
    if (runStarted && runMetaPathAbs) {
      const runFinishedAtMs = Date.now();
      await writeRunMeta({
        runMetaPathAbs,
        runMeta: {
          status: "failed",
          runCooldownMs,
          startedAtMs: runStartedAtMs,
          startedAtIso: new Date(runStartedAtMs).toISOString(),
          finishedAtMs: runFinishedAtMs,
          finishedAtIso: new Date(runFinishedAtMs).toISOString(),
          durationMs: runFinishedAtMs - runStartedAtMs,
          packNames: runPackNames,
          errorMessage: normalizeErrorMessage(error),
        },
      });
    }

    console.error("\nfigma2phaser failed");
    console.error(error);
    process.exitCode = 1;
  }
}

main();

/** Config */
/** Загружает пользовательский конфиг и объединяет его с дефолтами. */
function loadConfig() {
  const configPath = path.resolve(__dirname, "figma2phaser.config.js");
  if (!fs.existsSync(configPath)) {
    console.log("figma2phaser.config.js not found, use defaults");
    return normalizeConfig(DEFAULT_CONFIG);
  }

  delete require.cache[configPath];
  const raw = require(configPath);
  const userConfig = raw && raw.default ? raw.default : raw;

  const merged = {
    ...DEFAULT_CONFIG,
    ...(userConfig || {}),
    texturePackerOptions: {
      ...DEFAULT_CONFIG.texturePackerOptions,
      ...((userConfig && userConfig.texturePackerOptions) || {}),
    },
    packs:
      userConfig && Array.isArray(userConfig.packs)
        ? userConfig.packs
        : DEFAULT_CONFIG.packs,
  };

  return normalizeConfig(merged);
}

/** Нормализует общий конфиг и гарантирует корректные поля. */
function normalizeConfig(config) {
  const packs = Array.isArray(config.packs) ? config.packs : [];
  return {
    runCooldownMs: Number(config.runCooldownMs ?? DEFAULT_CONFIG.runCooldownMs),
    runMetaPath: config.runMetaPath || DEFAULT_CONFIG.runMetaPath,
    figmaParseDelay: Number(config.figmaParseDelay || DEFAULT_CONFIG.figmaParseDelay),
    tmpDir: config.tmpDir || DEFAULT_CONFIG.tmpDir,
    atlasOutputDir: config.atlasOutputDir || DEFAULT_CONFIG.atlasOutputDir,
    autoAssetsOutputPath:
      config.autoAssetsOutputPath || DEFAULT_CONFIG.autoAssetsOutputPath,
    autoAssetsExportName:
      config.autoAssetsExportName || DEFAULT_CONFIG.autoAssetsExportName,
    figmaAssetsSceneDir:
      config.figmaAssetsSceneDir || DEFAULT_CONFIG.figmaAssetsSceneDir,
    texturePackerOptions: {
      ...DEFAULT_CONFIG.texturePackerOptions,
      ...(config.texturePackerOptions || {}),
    },
    packs: packs.map(normalizePackConfig),
  };
}

/** Нормализует один pack из конфига и проверяет обязательные поля. */
function normalizePackConfig(pack, index) {
  const packNameRaw = pack && pack.packName ? String(pack.packName) : `pack-${index + 1}`;
  const packName = toKebabCase(packNameRaw);
  const phaserSceneName = pack && pack.phaserSceneName ? String(pack.phaserSceneName) : toPascalCase(packName);
  const figmaNodeUrl = pack && pack.figmaNodeUrl ? String(pack.figmaNodeUrl) : "";

  if (!figmaNodeUrl) {
    throw new Error(`pack "${packName}" has empty figmaNodeUrl`);
  }

  return {
    packName,
    phaserSceneName,
    figmaNodeUrl,
  };
}

/** Преобразует относительные пути из конфига в абсолютные пути проекта. */
function resolveConfigPaths(config) {
  return {
    ...config,
    runMetaPathAbs: path.resolve(PROJECT_ROOT, config.runMetaPath),
    tmpDirAbs: path.resolve(PROJECT_ROOT, config.tmpDir),
    atlasOutputDirAbs: path.resolve(PROJECT_ROOT, config.atlasOutputDir),
    autoAssetsOutputPathAbs: path.resolve(PROJECT_ROOT, config.autoAssetsOutputPath),
    figmaAssetsSceneDirAbs: path.resolve(PROJECT_ROOT, config.figmaAssetsSceneDir),
  };
}

/** Читает токен Figma из переменных окружения. */
function readFigmaTokenFromEnv() {
  const token = process.env.FIGMA_TOKEN || process.env.FIGMA_API_TOKEN;
  if (!token) {
    throw new Error("No FIGMA_TOKEN or FIGMA_API_TOKEN in .env");
  }
  return token;
}

/** Загружает .env в process.env без сторонних зависимостей. */
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

/** Разбирает одну строку .env в пару key/value. */
function parseDotEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex < 1) return null;

  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

/** Читает мета-информацию предыдущего запуска из tmp-файла. */
async function readRunMeta(runMetaPathAbs) {
  const exists = fs.existsSync(runMetaPathAbs);
  if (!exists) return null;

  try {
    const raw = await fsp.readFile(runMetaPathAbs, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Проверяет, прошел ли минимальный интервал между запусками. */
function assertRunCooldown(props) {
  const { previousRunMeta, runCooldownMs, nowMs } = props;
  if (!previousRunMeta) return;

  const previousStartedAtMs = Number(previousRunMeta.startedAtMs || 0);
  if (!Number.isFinite(previousStartedAtMs) || previousStartedAtMs <= 0) return;

  const elapsedMs = nowMs - previousStartedAtMs;
  if (elapsedMs >= runCooldownMs) return;

  const waitMsLeft = runCooldownMs - elapsedMs;
  const waitSeconds = Math.ceil(waitMsLeft / 1000);
  const allowAtIso = new Date(previousStartedAtMs + runCooldownMs).toISOString();
  throw new Error(
    `Run cooldown is active. Wait ${waitSeconds}s and retry (allowed at ${allowAtIso}).`,
  );
}

/** Записывает заметки о текущем запуске в tmp-файл. */
async function writeRunMeta(props) {
  const { runMetaPathAbs, runMeta } = props;
  const payload = {
    script: "figma2phaser",
    version: 1,
    ...runMeta,
    updatedAtMs: Date.now(),
    updatedAtIso: new Date().toISOString(),
  };
  await ensureDir(path.dirname(runMetaPathAbs));
  await fsp.writeFile(runMetaPathAbs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Приводит ошибку к строковому сообщению для сохранения в мета-файл. */
function normalizeErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Pipeline */
/** Обрабатывает один pack: Figma -> PNG -> atlas -> метаданные для генерации кода. */
async function processPack(props) {
  const { pack, figmaToken, tmpDirAbs, atlasOutputDirAbs, texturePackerOptions } = props;
  const parsedUrl = parseFigmaNodeUrl(pack.figmaNodeUrl);
  const rootNode = await fetchFigmaRootNode({
    fileKey: parsedUrl.fileKey,
    nodeId: parsedUrl.nodeId,
    figmaToken,
  });

  const topChildren = getTopLevelChildren(rootNode);
  if (topChildren.length === 0) {
    throw new Error(`pack "${pack.packName}" has no top-level children`);
  }

  const childDescriptors = buildChildDescriptors({
    packName: pack.packName,
    rootNode,
    topChildren,
  });

  if (childDescriptors.length === 0) {
    throw new Error(`pack "${pack.packName}" has no exportable children`);
  }

  const exportUrls = await fetchFigmaExportUrls({
    fileKey: parsedUrl.fileKey,
    nodeIds: childDescriptors.map((item) => item.nodeId),
    figmaToken,
  });

  const preparedDescriptors = childDescriptors.filter((item) => exportUrls[item.nodeId]);
  if (preparedDescriptors.length === 0) {
    throw new Error(`pack "${pack.packName}" has no exported png urls`);
  }

  const packTmpDirAbs = path.join(tmpDirAbs, pack.packName);
  await fsp.rm(packTmpDirAbs, { recursive: true, force: true });
  await ensureDir(packTmpDirAbs);

  for (const descriptor of preparedDescriptors) {
    const pngUrl = exportUrls[descriptor.nodeId];
    const outputPath = path.join(packTmpDirAbs, descriptor.frameName);
    await downloadFile({ url: pngUrl, outputPath });
  }

  const atlasFiles = await packTmpFolderToAtlas({
    packName: pack.packName,
    inputDirAbs: packTmpDirAbs,
    outputDirAbs: atlasOutputDirAbs,
    texturePackerOptions,
  });

  const atlasUrls = resolveAtlasUrls(atlasFiles);
  console.log(
    `pack "${pack.packName}" completed: ${preparedDescriptors.length} images -> ${atlasUrls.pngUrl}`,
  );

  return {
    packName: pack.packName,
    phaserSceneName: pack.phaserSceneName,
    atlas: {
      name: toCamelCase(pack.packName),
      pngUrl: atlasUrls.pngUrl,
      jsonUrl: atlasUrls.jsonUrl,
    },
    images: preparedDescriptors,
  };
}

/** Figma API */
/** Парсит figmaNodeUrl и извлекает fileKey/nodeId. */
function parseFigmaNodeUrl(figmaNodeUrl) {
  const parsed = new URL(figmaNodeUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new Error(`Invalid figmaNodeUrl path: ${figmaNodeUrl}`);
  }

  let fileKey = segments[1];
  const branchIndex = segments.indexOf("branch");
  if (branchIndex >= 0 && segments[branchIndex + 1]) {
    fileKey = segments[branchIndex + 1];
  }

  const nodeIdRaw = parsed.searchParams.get("node-id");
  if (!nodeIdRaw) {
    throw new Error(`No node-id in figmaNodeUrl: ${figmaNodeUrl}`);
  }

  const nodeId = decodeURIComponent(nodeIdRaw).replace(/-/g, ":");
  return {
    fileKey,
    nodeId,
  };
}

/** Загружает корневой node из Figma API по fileKey/nodeId. */
async function fetchFigmaRootNode(props) {
  const { fileKey, nodeId, figmaToken } = props;
  const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`;
  const payload = await fetchJsonFromFigma(url, figmaToken);
  const nodeContainer = payload && payload.nodes ? payload.nodes[nodeId] : null;
  if (!nodeContainer || !nodeContainer.document) {
    throw new Error(`Figma node not found: ${fileKey}:${nodeId}`);
  }
  return nodeContainer.document;
}

/** Возвращает только верхних видимых детей заданного Figma-узла. */
function getTopLevelChildren(rootNode) {
  if (!rootNode || !Array.isArray(rootNode.children)) return [];
  return rootNode.children.filter((child) => child && child.visible !== false);
}

/** Готовит дескрипторы изображений с именами и координатами относительно корневого node. */
function buildChildDescriptors(props) {
  const { packName, rootNode, topChildren } = props;
  const rootBounds = readAbsoluteBounds(rootNode) || { x: 0, y: 0, width: 0, height: 0 };
  const usedFrameNames = new Set();
  const usedFunctionNames = new Set();
  const descriptors = [];

  for (const child of topChildren) {
    const bounds = readAbsoluteBounds(child);
    if (!bounds) continue;

    const frameBase = uniqueName({
      candidate: toKebabCase(child.name || `node-${child.id}`),
      fallback: `node-${toKebabCase(String(child.id || "x"))}`,
      used: usedFrameNames,
    });
    const localName = toCamelCase(frameBase);
    const imageName = toCamelCase(`${packName}-${frameBase}`);
    const functionName = uniqueName({
      candidate: `add${toPascalCase(localName)}`,
      fallback: "addImage",
      used: usedFunctionNames,
    });

    descriptors.push({
      nodeId: String(child.id),
      sourceName: String(child.name || child.id),
      frameName: `${frameBase}.png`,
      localName,
      imageName,
      functionName,
      x: Math.round(bounds.x - rootBounds.x),
      y: Math.round(bounds.y - rootBounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  }

  descriptors.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.imageName.localeCompare(b.imageName);
  });

  return descriptors;
}

/** Читает absoluteBoundingBox из node и приводит к безопасному формату. */
function readAbsoluteBounds(node) {
  if (!node || !node.absoluteBoundingBox) return null;
  const box = node.absoluteBoundingBox;
  if (typeof box.x !== "number" || typeof box.y !== "number") return null;
  if (typeof box.width !== "number" || typeof box.height !== "number") return null;
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

/** Получает export URL для PNG по списку nodeId (с разбиением на чанки). */
async function fetchFigmaExportUrls(props) {
  const { fileKey, nodeIds, figmaToken } = props;
  const chunks = chunkArray(nodeIds, 100);
  const imageMap = {};

  for (const ids of chunks) {
    const query = new URLSearchParams();
    query.set("ids", ids.join(","));
    query.set("format", "png");
    query.set("scale", "1");

    const url = `https://api.figma.com/v1/images/${encodeURIComponent(fileKey)}?${query.toString()}`;
    const payload = await fetchJsonFromFigma(url, figmaToken);
    const images = payload && payload.images ? payload.images : {};

    for (const [nodeId, imageUrl] of Object.entries(images)) {
      if (typeof imageUrl === "string" && imageUrl.length > 0) {
        imageMap[nodeId] = imageUrl;
      }
    }
  }

  return imageMap;
}

/** Выполняет JSON-запрос к Figma API с токеном авторизации. */
async function fetchJsonFromFigma(url, figmaToken) {
  const response = await fetch(url, {
    headers: {
      "X-Figma-Token": figmaToken,
    },
  });
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      buildHttpErrorMessage({
        errorTitle: "Figma API request failed",
        url,
        response,
        responseText,
      }),
    );
  }
  return response.json();
}

/** File IO and packer */
/** Скачивает файл по URL и сохраняет его на диск. */
async function downloadFile(props) {
  const { url, outputPath } = props;
  const response = await fetch(url);
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      buildHttpErrorMessage({
        errorTitle: "Image download failed",
        url,
        response,
        responseText,
      }),
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await ensureDir(path.dirname(outputPath));
  await fsp.writeFile(outputPath, buffer);
}

/** Собирает подробный текст HTTP-ошибки с полным списком заголовков ответа. */
function buildHttpErrorMessage(props) {
  const { errorTitle, url, response, responseText } = props;
  const headers = responseHeadersToObject(response.headers);
  const retryAfter = headers["retry-after"] || "n/a";
  const body = responseText && responseText.length > 0 ? responseText : "(empty body)";

  return [
    `${errorTitle}: HTTP ${response.status} ${response.statusText}`,
    `URL: ${url}`,
    `Retry-After: ${retryAfter}`,
    `Headers: ${JSON.stringify(headers, null, 2)}`,
    `Body: ${body}`,
  ].join("\n");
}

/** Преобразует Headers в обычный объект key/value для логирования. */
function responseHeadersToObject(headers) {
  const result = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/** Собирает atlas (png/json) из PNG-файлов временной папки pack. */
async function packTmpFolderToAtlas(props) {
  const { packName, inputDirAbs, outputDirAbs, texturePackerOptions } = props;
  const images = await collectPngFiles(inputDirAbs, inputDirAbs);
  if (images.length === 0) {
    throw new Error(`No PNG files for pack "${packName}" in ${inputDirAbs}`);
  }

  const files = await packAsync(images, {
    ...texturePackerOptions,
    textureName: packName,
  });

  await ensureDir(outputDirAbs);

  const writtenFiles = [];
  for (const file of files) {
    const outputPath = path.join(outputDirAbs, file.name);
    await fsp.writeFile(outputPath, file.buffer);
    writtenFiles.push(outputPath);
  }

  return writtenFiles;
}

/** Рекурсивно собирает все PNG из папки в формат для free-tex-packer-core. */
async function collectPngFiles(dirAbs, baseDirAbs) {
  const entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const fullPath = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectPngFiles(fullPath, baseDirAbs);
      result.push(...nested);
      continue;
    }

    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".png") continue;

    const relPath = toPosixPath(path.relative(baseDirAbs, fullPath));
    const buffer = await fsp.readFile(fullPath);
    result.push({
      path: relPath,
      contents: buffer,
    });
  }

  return result;
}

/** Преобразует callback API free-tex-packer-core в Promise. */
function packAsync(images, options) {
  return new Promise((resolve, reject) => {
    texturePacker(images, options, (files, error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(files || []);
    });
  });
}

/** Находит итоговые png/json atlas-файлы и возвращает их публичные URL. */
function resolveAtlasUrls(writtenAtlasFiles) {
  const pngPath = writtenAtlasFiles.find((item) => path.extname(item) === ".png");
  const jsonPath = writtenAtlasFiles.find((item) => path.extname(item) === ".json");

  if (!pngPath || !jsonPath) {
    throw new Error(`Atlas files are incomplete: ${writtenAtlasFiles.join(", ")}`);
  }

  return {
    pngUrl: toPublicAssetUrl(pngPath),
    jsonUrl: toPublicAssetUrl(jsonPath),
  };
}

/** Приводит абсолютный путь файла к URL относительно public/ или корня проекта. */
function toPublicAssetUrl(absPath) {
  const publicRoot = path.resolve(PROJECT_ROOT, "public");
  const relFromPublic = path.relative(publicRoot, absPath);
  if (!relFromPublic.startsWith("..") && !path.isAbsolute(relFromPublic)) {
    return `./${toPosixPath(relFromPublic)}`;
  }

  const relFromRoot = path.relative(PROJECT_ROOT, absPath);
  return `./${toPosixPath(relFromRoot)}`;
}

/** Создает директорию рекурсивно, если ее еще нет. */
async function ensureDir(dirAbs) {
  await fsp.mkdir(dirAbs, { recursive: true });
}

/** Делает паузу на заданное количество миллисекунд. */
function waitMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Auto assets generation */
/** Собирает объект autoFigmaAssets на базе результатов всех pack. */
function buildAutoFigmaAssets(props) {
  const { packResults } = props;
  const imageEntries = [];

  for (const pack of packResults) {
    for (const image of pack.images) {
      imageEntries.push([
        image.imageName,
        {
          url: pack.atlas.pngUrl,
          name: image.imageName,
          frameName: image.frameName,
          width: image.width,
          height: image.height,
          x: image.x,
          y: image.y,
        },
      ]);
    }
  }

  imageEntries.sort((a, b) => a[0].localeCompare(b[0]));
  const images = Object.fromEntries(imageEntries);

  const atlases = packResults.map((pack) => ({
    name: pack.atlas.name,
    pngUrl: pack.atlas.pngUrl,
    jsonUrl: pack.atlas.jsonUrl,
  }));
  atlases.sort((a, b) => a.name.localeCompare(b.name));

  return {
    images,
    preload: {
      atlases,
    },
  };
}

/** Записывает autoFigmaAssets.ts на диск. */
async function writeAutoAssetsFile(props) {
  const { autoAssets, outputPathAbs, exportName } = props;
  const source = buildAutoAssetsTsSource(autoAssets, exportName);
  await ensureDir(path.dirname(outputPathAbs));
  await fsp.writeFile(outputPathAbs, source, "utf8");
  console.log(`write ${toPosixPath(path.relative(PROJECT_ROOT, outputPathAbs))}`);
}

/** Генерирует TypeScript-код файла autoFigmaAssets.ts. */
function buildAutoAssetsTsSource(autoAssets, exportName) {
  const jsonString = JSON.stringify(autoAssets, null, 2);
  return `// This file is auto-generated by figma2phaser.js. Do not edit manually.
export const ${exportName} = ${jsonString} as const;

export function preloadAutoFigmaAssets(scene: Phaser.Scene): void {
  ${exportName}.preload.atlases.forEach((atlas) => {
    if (scene.textures.exists(atlas.pngUrl)) return;
    scene.load.atlas(atlas.pngUrl, atlas.pngUrl, atlas.jsonUrl);
  });
}
`;
}

/** TS files for packs */
/** Генерирует TS-файлы для каждого pack: add-функции, тестовую сцену и index.ts. */
async function writePackCodeFiles(props) {
  const {
    autoAssets,
    packResults,
    sceneDirAbs,
    autoAssetsPathAbs,
    autoAssetsExportName,
  } = props;
  await ensureDir(sceneDirAbs);

  const autoAssetsImport = toModuleImportPath(path.relative(sceneDirAbs, autoAssetsPathAbs));
  const imagesByAtlasUrl = groupImagesByAtlasUrl(autoAssets.images);
  const typesPath = path.join(sceneDirAbs, "types.ts");
  const typesSource = buildFigmaAssetsTypesSource({
    autoAssetsImportPath: autoAssetsImport,
    autoAssetsExportName,
  });
  await fsp.writeFile(typesPath, typesSource, "utf8");
  console.log(`write ${toPosixPath(path.relative(PROJECT_ROOT, typesPath))}`);

  const utilsPath = path.join(sceneDirAbs, "utils.ts");
  const utilsSource = buildFigmaAssetsUtilsSource({
    autoAssetsImportPath: autoAssetsImport,
    autoAssetsExportName,
  });
  await fsp.writeFile(utilsPath, utilsSource, "utf8");
  console.log(`write ${toPosixPath(path.relative(PROJECT_ROOT, utilsPath))}`);

  for (const pack of packResults) {
    const codeImages = buildCodeImagesForPack(imagesByAtlasUrl[pack.atlas.pngUrl] || []);
    const assetsFileName = `${pack.packName}-assets.ts`;
    const sceneFileName = `${pack.packName}-scene.ts`;
    const assetsFilePath = path.join(sceneDirAbs, assetsFileName);
    const sceneFilePath = path.join(sceneDirAbs, sceneFileName);

    const assetsTs = buildPackAssetsTs({
      pack,
      codeImages,
      autoAssetsImportPath: autoAssetsImport,
      autoAssetsExportName,
    });
    const sceneTs = buildPackSceneTs({
      pack,
      assetsImportPath: `./${pack.packName}-assets`,
      codeImages,
    });

    await fsp.writeFile(assetsFilePath, assetsTs, "utf8");
    await fsp.writeFile(sceneFilePath, sceneTs, "utf8");

    console.log(`write ${toPosixPath(path.relative(PROJECT_ROOT, assetsFilePath))}`);
    console.log(`write ${toPosixPath(path.relative(PROJECT_ROOT, sceneFilePath))}`);
  }

  const indexPath = path.join(sceneDirAbs, "index.ts");
  const indexSource = buildFigmaAssetsIndexSource(packResults);
  await fsp.writeFile(indexPath, indexSource, "utf8");
  console.log(`write ${toPosixPath(path.relative(PROJECT_ROOT, indexPath))}`);
}

/** Строит исходник [pack]-assets.ts со списком ассетов pack. */
function buildPackAssetsTs(props) {
  const {
    pack,
    codeImages,
    autoAssetsImportPath,
    autoAssetsExportName,
  } = props;
  const packCamel = toCamelCase(pack.packName);
  const packPascal = toPascalCase(pack.packName);
  const packVarName = `${packCamel}AssetEntries`;
  const packImagesVarName = `${packCamel}AutoAssets`;
  const packConfigName = `${packCamel}AutoAssetsConfig`;
  const preloadFunctionName = `preload${packPascal}Assets`;
  const lines = [];
  lines.push("// This file is auto-generated by figma2phaser.js. Do not edit manually.");
  lines.push(`import { ${autoAssetsExportName} } from "${autoAssetsImportPath}";`);
  lines.push('import { AutoAssetDictionary, AutoAssetEntry, IAutoAssetsConfig } from "./types";');
  lines.push("");

  lines.push(`export const ${packVarName}: readonly AutoAssetEntry[] = [`);
  for (const image of codeImages) {
    lines.push(`  { kind: "${image.kind}", assetName: "${image.imageName}" },`);
  }
  lines.push("];");
  lines.push("");

  lines.push(`export const ${packImagesVarName}: AutoAssetDictionary = {`);
  for (const image of codeImages) {
    lines.push(`  ${image.imageName}: ${autoAssetsExportName}.images.${image.imageName},`);
  }
  lines.push("};");
  lines.push("");

  lines.push(`export const ${packConfigName}: IAutoAssetsConfig = {`);
  lines.push(`  images: ${packImagesVarName},`);
  lines.push("  preload: {");
  lines.push("    atlases: [");
  lines.push("      {");
  lines.push(`        name: "${pack.atlas.name}",`);
  lines.push(`        pngUrl: "${pack.atlas.pngUrl}",`);
  lines.push(`        jsonUrl: "${pack.atlas.jsonUrl}",`);
  lines.push("      },");
  lines.push("    ],");
  lines.push("  },");
  lines.push("} as const;");
  lines.push("");

  lines.push(`export function ${preloadFunctionName}(scene: Phaser.Scene): void {`);
  lines.push(`  ${packConfigName}.preload.atlases.forEach((atlas) => {`);
  lines.push("    if (scene.textures.exists(atlas.pngUrl)) return;");
  lines.push("    scene.load.atlas(atlas.pngUrl, atlas.pngUrl, atlas.jsonUrl);");
  lines.push("  });");
  lines.push("}");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

/** Строит исходник [pack]-scene.ts для визуального просмотра всех картинок pack. */
function buildPackSceneTs(props) {
  const { pack, assetsImportPath, codeImages } = props;
  const lines = [];
  const packVarName = `${toCamelCase(pack.packName)}AssetEntries`;
  const preloadFunctionName = `preload${toPascalCase(pack.packName)}Assets`;
  lines.push("// This file is auto-generated by figma2phaser.js. Do not edit manually.");
  lines.push('import { addAssetImage, addAssetNine } from "./utils";');
  lines.push(`import { ${packVarName}, ${preloadFunctionName} } from "${assetsImportPath}";`);
  lines.push("");

  const className = `${toPascalCase(pack.packName)}Scene`;
  const sceneKey = pack.phaserSceneName || className;

  lines.push(`export class ${className} extends Phaser.Scene {`);
  lines.push("  constructor() {");
  lines.push(`    super({ key: "${sceneKey}" });`);
  lines.push("  }");
  lines.push("");
  lines.push("  preload(): void {");
  lines.push(`    ${preloadFunctionName}(this);`);
  lines.push("  }");
  lines.push("");
  lines.push("  create(): void {");
  if (codeImages.length > 0) {
    lines.push(`    ${packVarName}.forEach((entry) => {`);
    lines.push('      if (entry.kind === "nine") {');
    lines.push("        addAssetNine({ scene: this, assetName: entry.assetName });");
    lines.push("        return;");
    lines.push("      }");
    lines.push("      addAssetImage({ scene: this, assetName: entry.assetName });");
    lines.push("    });");
  }
  lines.push("  }");
  lines.push("}");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

/** Строит общий index.ts для реэкспорта файлов из figmaAssetsSceneDir. */
function buildFigmaAssetsIndexSource(packResults) {
  const lines = [];
  lines.push("// This file is auto-generated by figma2phaser.js. Do not edit manually.");
  lines.push('export * from "./types";');
  lines.push('export * from "./utils";');
  for (const pack of packResults) {
    lines.push(`export * from "./${pack.packName}-assets";`);
    lines.push(`export * from "./${pack.packName}-scene";`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/** Строит общий types.ts c Auto*-типами для ассетов. */
function buildFigmaAssetsTypesSource(props) {
  const { autoAssetsImportPath, autoAssetsExportName } = props;
  return `// This file is auto-generated by figma2phaser.js. Do not edit manually.
import { ${autoAssetsExportName} } from "${autoAssetsImportPath}";

export type AutoAssetMap = typeof ${autoAssetsExportName}.images;

export type AutoAssetName = keyof AutoAssetMap;
export type AutoAsset = AutoAssetMap[AutoAssetName];
export type AutoAssetDictionary = Record<string, AutoAsset>;

type AutoFrameName<T extends AutoAssetName> = AutoAssetMap[T]["frameName"];
type AutoIsNineFrame<T extends string> = T extends \`\${string}nine.\${number}.png\` ? true : false;

export type AutoNineAssetName = {
  [K in AutoAssetName]: AutoIsNineFrame<AutoFrameName<K>> extends true ? K : never;
}[AutoAssetName];

export type AutoImageAssetName = Exclude<AutoAssetName, AutoNineAssetName>;

export interface IAutoAtlasConfig {
  readonly name: string;
  readonly pngUrl: string;
  readonly jsonUrl: string;
}

export interface IAutoAssetsConfig {
  readonly images: AutoAssetDictionary;
  readonly preload: {
    readonly atlases: readonly IAutoAtlasConfig[];
  };
}

export interface IAddAssetImageProps {
  scene: Phaser.Scene;
  assetName: AutoImageAssetName;
  x?: number;
  y?: number;
}

export interface IAddAssetNineProps {
  scene: Phaser.Scene;
  assetName: AutoNineAssetName;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}

export interface IAutoAssetImageEntry {
  readonly kind: "image";
  readonly assetName: AutoImageAssetName;
}

export interface IAutoAssetNineEntry {
  readonly kind: "nine";
  readonly assetName: AutoNineAssetName;
}

export type AutoAssetEntry = IAutoAssetImageEntry | IAutoAssetNineEntry;
`;
}

/** Строит общий utils.ts для функций добавления картинок в сцену. */
function buildFigmaAssetsUtilsSource(props) {
  const { autoAssetsImportPath, autoAssetsExportName } = props;
  return `// This file is auto-generated by figma2phaser.js. Do not edit manually.
import { Align } from "@kvisaz/phaser-sugar";
import { ${autoAssetsExportName} } from "${autoAssetsImportPath}";
import { IAddAssetImageProps, IAddAssetNineProps } from "./types";

function resolveNinePadding(frameName: string): number {
  const match = String(frameName || "").match(/(?:^|[._-])nine\\.(\\d+)\\.png$/i);
  if (!match) {
    throw new Error(\`Asset frameName "\${frameName}" is not nine.<padding>.png\`);
  }
  return Number(match[1]);
}

export function addAssetImage(
  props: IAddAssetImageProps,
): Phaser.GameObjects.Image {
  const { scene, assetName, x, y } = props;
  const imageAsset = ${autoAssetsExportName}.images[assetName];
  const targetX = x ?? imageAsset.x;
  const targetY = y ?? imageAsset.y;
  const imageNode = scene.add.image(0, 0, imageAsset.url, imageAsset.frameName);
  Align.setLeftTop(imageNode, targetX, targetY);
  return imageNode;
}

export function addAssetNine(
  props: IAddAssetNineProps,
): Phaser.GameObjects.NineSlice {
  const { scene, assetName, width, height, x, y } = props;
  const imageAsset = ${autoAssetsExportName}.images[assetName];
  const padding = resolveNinePadding(imageAsset.frameName);
  const targetWidth = width ?? imageAsset.width;
  const targetHeight = height ?? imageAsset.height;
  const targetX = x ?? imageAsset.x;
  const targetY = y ?? imageAsset.y;
  const nineSliceNode = scene.add.existing(
    new Phaser.GameObjects.NineSlice(
      scene,
      0,
      0,
      imageAsset.url,
      imageAsset.frameName,
      targetWidth,
      targetHeight,
      padding,
      padding,
      padding,
      padding,
    ),
  );
  Align.setLeftTop(nineSliceNode, targetX, targetY);
  return nineSliceNode;
}
`;
}

/** Группирует записи images по atlas URL (images[*].url). */
function groupImagesByAtlasUrl(imagesRecord) {
  const grouped = {};
  for (const [imageName, imageData] of Object.entries(imagesRecord || {})) {
    const atlasUrl = imageData.url;
    if (!grouped[atlasUrl]) {
      grouped[atlasUrl] = [];
    }
    grouped[atlasUrl].push({
      imageName,
      frameName: imageData.frameName,
      x: Number(imageData.x || 0),
      y: Number(imageData.y || 0),
    });
  }
  return grouped;
}

/** Подготавливает список asset-entries (image/nine) на основе сгруппированных изображений. */
function buildCodeImagesForPack(items) {
  const sorted = [...items].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.imageName.localeCompare(b.imageName);
  });

  return sorted.map((item) => {
    const frameBase = path.basename(item.frameName, path.extname(item.frameName));
    const ninePadding = extractNineSlicePadding(frameBase);

    return {
      imageName: item.imageName,
      kind: ninePadding === null ? "image" : "nine",
    };
  });
}

/** Определяет padding nine-slice, если имя фрейма заканчивается на nine.<число>. */
function extractNineSlicePadding(frameBaseName) {
  const match = String(frameBaseName || "").match(/(?:^|[._-])nine\.(\d+)$/i);
  if (!match) return null;

  const padding = Number(match[1]);
  if (!Number.isFinite(padding)) return null;
  return padding;
}

/** Utils */
/** Делит массив на чанки фиксированного размера. */
function chunkArray(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/** Возвращает уникальное имя, добавляя числовой суффикс при коллизиях. */
function uniqueName(props) {
  const { candidate, fallback, used } = props;
  const base = toSafeToken(candidate, fallback);
  let next = base;
  let index = 2;
  while (used.has(next)) {
    next = `${base}${index}`;
    index += 1;
  }
  used.add(next);
  return next;
}

/** Преобразует относительный путь в корректный import-путь без расширения. */
function toModuleImportPath(relPath) {
  const noExt = relPath.replace(/\.[^.]+$/, "");
  const normalized = toPosixPath(noExt);
  if (normalized.startsWith(".")) return normalized;
  return `./${normalized}`;
}

/** Нормализует путь к POSIX-формату для генерации файлов и URL. */
function toPosixPath(inputPath) {
  return inputPath.split(path.sep).join("/");
}

/** Переводит строку в kebab-case. */
function toKebabCase(input) {
  const safe = toSafeToken(input, "item");
  return safe
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/** Переводит строку в camelCase. */
function toCamelCase(input) {
  const safe = toSafeToken(input, "item");
  const tokens = safe
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());

  if (tokens.length === 0) return "item";
  const [first, ...rest] = tokens;
  const camel = first + rest.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join("");
  if (/^[0-9]/.test(camel)) return `n${camel}`;
  return camel;
}

/** Переводит строку в PascalCase. */
function toPascalCase(input) {
  const camel = toCamelCase(input);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** Очищает строку от неподходящих символов и возвращает безопасный токен. */
function toSafeToken(input, fallback) {
  const raw = String(input || "");
  const latin = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = latin
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (!safe) return fallback;
  return safe;
}
