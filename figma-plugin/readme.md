# Figma2Assets Export Plugin

Плагин делает полный экспорт для Phaser внутри одного ZIP:
- исходные PNG верхних детей выбранного узла;
- `manifest.json` с координатами;
- atlas (`png + json`) в формате совместимом с Phaser3;
- готовые TypeScript-файлы сцены и утилит.

## Структура плагина

- `manifest.json` — манифест плагина для Figma;
- `code.js` — экспорт PNG и manifest из выбранного узла;
- `ui.html` — UI, atlas packing, генерация TS, сборка ZIP;
- `readme.md` — инструкция.

## Что экспортируется

Из выбранного корневого узла:
- только **верхние дети**;
- каждый верхний ребенок — отдельный PNG;
- координаты считаются относительно левого верхнего угла корневого узла.

Если имя узла заканчивается на `nine.<число>`, в `manifest.json` пишется:
- `kind: "nine"`
- `ninePadding: <число>`

## Итоговая структура ZIP

- `png/`
- `manifest.json`
- `phaser/atlases/[packName].json`
- `phaser/atlases/[packName].png`
- `phaser/scene/[packName]-scene.ts`
- `phaser/scene/[packName]-assets.ts`
- `phaser/scene/utils.ts`
- `phaser/scene/types.ts`

`packName` по умолчанию берется из имени выбранного узла (slug), но можно изменить в UI перед скачиванием.

`atlasBasePath` задается в UI отдельным полем.
По умолчанию: `./assets/atlases/`.
Этот путь используется в генерируемом `preload`-конфиге как `pngUrl/jsonUrl`, например:
`./assets/atlases/cards-figures.png`.

## Что есть в `[packName]-assets.ts`

Для каждого pack генерируются:
- `export const <packCamel>AutoAssetsConfig` — pack-конфиг в формате `images + preload.atlases`;
- `export function preload<PackPascal>Assets(scene: Phaser.Scene)` — preload-функция для atlas этого pack;
- `export const <packCamel>AutoAssets` и `export const <packCamel>AutoAssetOrder` для удобного обхода ассетов.

Сгенерированная `[packName]-scene.ts` использует именно эту preload-функцию в `preload()`.

## Как установить (Development Plugin)

1. Откройте Figma Desktop или Web.
2. Перейдите в `Plugins -> Development -> Import plugin from manifest...`.
3. Выберите `figma2assets/figma-plugin/manifest.json`.
4. Запускайте из `Plugins -> Development -> Figma2Assets Export`.

## Как пользоваться

1. Выберите ровно один корневой узел в Figma.
2. Запустите плагин.
3. Дождитесь статуса `Экспорт завершен`.
4. При необходимости отредактируйте `packName` в UI.
5. Нажмите `Скачать ZIP`.

## Встроенный atlas-пэкер

В `ui.html` реализован простой `shelf`-пэкер:
- раскладка по строкам слева направо;
- `padding = 2` между frame;
- размер atlas округляется до ближайшей степени двойки.

Пэкер сделан специально простым и предсказуемым для надежной работы без внешних Node-зависимостей.

## Формат manifest.json

Пример:

```json
{
  "version": 1,
  "generatedAtIso": "2026-02-23T00:00:00.000Z",
  "packName": "atlas",
  "root": {
    "nodeId": "3:469",
    "name": "atlas",
    "width": 1280,
    "height": 720
  },
  "items": [
    {
      "nodeId": "3:470",
      "name": "ui.button.normal.nine.20",
      "fileName": "ui.button.normal.nine.20.png",
      "x": 832,
      "y": 231,
      "width": 128,
      "height": 128,
      "kind": "nine",
      "ninePadding": 20
    }
  ],
  "skipped": []
}
```

## Ограничения

- Экспортируются только верхние дети выбранного узла.
- Скрытые (`visible=false`) дети пропускаются.
- ZIP собирается через локальный файл `jszip.min.js` (без CDN).

## Частые ошибки

- `Выберите ровно один корневой узел` — выделено 0 или >1 узлов.
- `Выбранный узел не поддерживает children` — выбран узел без children.
- `Не удалось экспортировать ни одного PNG` — все дети пропущены/упали при export.

## Примечание про окно плагина

Окно плагина можно перемещать как плавающее, но закрепить как постоянную панель Figma нельзя.
