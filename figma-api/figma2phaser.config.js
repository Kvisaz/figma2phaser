module.exports = {
  // Минимальный интервал между запусками скрипта (мс).
  runCooldownMs: 60_000,
  // Файл с заметками о предыдущем запуске (время, статус, ошибка).
  runMetaPath: "./tmp/figma2phaser-last-run.json",
  // Задержка между запросами разных pack (в миллисекундах). Первый pack обрабатывается без ожидания.
  figmaParseDelay: 15_000,
  // Временная папка для PNG, выгруженных из Figma перед упаковкой в atlas.
  tmpDir: "./tmp",
  // Папка для готовых atlas-файлов (*.png + *.json), доступных из public.
  atlasOutputDir: "./public/assets/atlases",
  // Путь к автогенерируемому TypeScript-файлу с описанием ассетов.
  autoAssetsOutputPath: "./src/autoFigmaAssets.ts",
  // Имя экспортируемой константы в autoAssetsOutputPath.
  autoAssetsExportName: "autoFigmaAssets",
  // Папка, куда скрипт генерирует [pack]-assets.ts, [pack]-scene.ts и index.ts.
  figmaAssetsSceneDir: "./src/scenes/shared/figmaAssets",
  // Опции упаковки atlas через free-tex-packer-core.
  texturePackerOptions: {
    fixedSize: false,
    padding: 2,
    allowRotation: false,
    detectIdentical: false,
    allowTrim: false,
    exporter: "Phaser3",
    packer: "MaxRectsPacker",
  },
  // Список pack. Один pack = один Figma node URL и один итоговый atlas.
  packs: [
    {
      // Имя pack (используется в именах atlas и генерируемых TS-файлов).
      packName: "phaser-assets",
      // Ключ тестовой Phaser-сцены предпросмотра этого pack.
      phaserSceneName: "PhaserAssets",
      // URL узла в Figma. Скрипт экспортирует только верхних детей этого узла.
      figmaNodeUrl:
        "https://www.figma.com/design/hixD9GHjOlkKVdCOYS0Z3A/%D0%9F%D0%B0%D1%81%D1%8C%D1%8F%D0%BD%D1%81-%D0%9F%D0%B0%D1%83%D0%BA-%D0%A7%D0%B8%D0%B1%D0%B8?node-id=3-469&t=kAwBUVRFB7j50p3K-0",
    },
  ],
};
