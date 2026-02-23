# figma2phaser.config.js

Конфиг для `figma2phaser.js`.

## Поля верхнего уровня

- `runCooldownMs: number`
  - Минимальный интервал между запусками скрипта, в миллисекундах.
  - Если интервал не прошел, запуск прерывается до обращения к Figma API.

- `runMetaPath: string`
  - Путь к файлу в `tmp` с заметками о последнем запуске.
  - В файле сохраняются статус (`started/success/failed`), время запуска/завершения и текст ошибки.

- `figmaParseDelay: number`
  - Задержка между обработкой pack, в миллисекундах.
  - Первый pack всегда стартует без задержки.

- `tmpDir: string`
  - Временная папка для PNG, выгруженных из Figma перед упаковкой.

- `atlasOutputDir: string`
  - Папка для итоговых atlas-файлов (`.png` и `.json`).
  - Обычно это путь внутри `public`.

- `autoAssetsOutputPath: string`
  - Путь к автогенерируемому файлу `autoFigmaAssets.ts`.

- `autoAssetsExportName: string`
  - Имя экспортируемой константы в `autoAssetsOutputPath`.

- `figmaAssetsSceneDir: string`
  - Папка для автогенерации:
  - `[packName]-assets.ts`
  - `[packName]-scene.ts`
  - `index.ts`

- `texturePackerOptions: object`
  - Опции `free-tex-packer-core`.
  - Рекомендуемо оставлять `exporter: "Phaser3"` и `packer: "MaxRectsPacker"`.

- `packs: Array<PackConfig>`
  - Список pack-ов для обработки.

## PackConfig

- `packName: string`
  - Идентификатор pack.
  - Используется в именах atlas и TS-файлов.

- `phaserSceneName?: string`
  - Ключ тестовой Phaser-сцены для предпросмотра pack.
  - Если не задан, имя строится из `packName`.

- `figmaNodeUrl: string`
  - URL узла в Figma.
  - Скрипт экспортирует только верхних детей этого узла.

## Токен Figma

Скрипт читает токен из `.env`:
- `FIGMA_TOKEN` (приоритетный)
- `FIGMA_API_TOKEN` (fallback)
