# TODO: перейти на class-only view generation

Нужно изменить генерацию Phaser TypeScript так, чтобы все root `view*` / `button*` больше не создавались factory-функциями в общем `[packName].view.ts`, а генерировались как отдельные class components в отдельных файлах.

Подробная задача: [doc/2026-05-05-generated-view-classes-task.md](doc/2026-05-05-generated-view-classes-task.md)

Status: baseline реализован. Generated output теперь пишет `[packName]/views/*.ts`, `[packName]/views/index.ts`, локальные text constants, inline asset data и не генерирует `[packName].text.ts` / `[packName]-scene.ts`.

## Целевой контракт

1. Каждый root view генерируется как отдельный файл.
   - Например: `[tsOutputDir]/[packName]/views/ButtonSelectStyle.ts`, `[tsOutputDir]/[packName]/views/ViewShop.ts`.
   - Внутри файла: local data constants, props interface, `export class Xxx extends Phaser.GameObjects.Container`.
   - Barrel/re-export живет в `[tsOutputDir]/[packName]/views/index.ts`.

2. Все views генерируются как классы.
   - Старые `createXxx(...)` factory-функции больше не являются основным output.
   - Если нужна совместимость, допускается thin factory рядом с class, но это временный слой.

3. Text data больше не выводится в отдельный `[packName].text.ts`.
   - Тексты конкретного root view кладутся в его же файл перед class.
   - Все тексты view желательно упаковать в одну константу, например `buttonSelectStyleTexts`.
   - В text data остаются только `localeMap` и `style`.

4. Asset registry file остается.
   - `[tsOutputDir]/[packName]/assets.ts` по-прежнему нужен для preload, atlas metadata и списка ассетов.
   - Но view/class файлы не импортируют `[packName]/assets.ts` и не ссылаются на его константы.
   - Все asset data, нужные конкретному view, инлайнятся прямо в файл view как скопированные object literals.

5. Pack output изолирован отдельной папкой.
   - Все TypeScript-файлы конкретного pack пишутся в `[tsOutputDir]/[packName]/`.
   - `utils/` и `types.ts` копируются туда же.
   - Scene preview file больше не генерируется.
   - `packName` редактируется в UI plugin и используется как имя этой папки.

## Рекомендуемый план

1. Зафиксировать новую output structure.
   - Путь для class files: `[tsOutputDir]/[packName]/views/[ClassName].ts`.
   - Barrel export: `[tsOutputDir]/[packName]/views/index.ts`.
   - Asset registry: `[tsOutputDir]/[packName]/assets.ts`.
   - Обновить список generated files в README.

2. Добавить template infrastructure.
   - Создать `server/src/export/templates/`.
   - Добавить template для root view class.
   - Использовать простой `renderTemplate(name, values)` без внешней зависимости.

3. Перестроить модель генерации view.
   - Вместо одного `buildViewsTs(...)` должен появиться output из нескольких файлов.
   - Каждый root view section возвращает `{ filePath, code }`.
   - `buildPhaserSceneSources(...)` и `writeExportFiles(...)` должны уметь записывать набор view files.

4. Перенести text generation внутрь view file.
   - Убрать отдельный `[packName].text.ts` из нового output.
   - Для каждого root view собрать все text children его дерева.
   - Сгенерировать одну локальную константу с text data только вида `{ localeMap, style }`.

5. Перевести asset references на inline data.
   - `buildViewEntries(...)` уже резолвит asset metadata через `assetEntries`.
   - На этапе генерации class file нужно вставлять literal asset data напрямую.
   - Во view files не должно быть import из `[packName]/assets.ts`.

6. Сгенерировать class constructors для всех view.
   - Root view class вызывает `super(scene, 0, 0)` или `super(props.scene, 0, 0)`.
   - Asset children создаются через `new Phaser.GameObjects.Image/NineSlice(...)`.
   - Text children создаются через `new Phaser.GameObjects.Text(...)`.
   - Nested view children создаются через `new NestedClass(...)` и импортируются из их отдельных файлов.

7. Стабилизировать shared runtime utils.
   - Оставить только реально нужные helpers: `center(...)`, `makeContainerInteractive(...)`, locale helpers, возможно low-level layout helpers.
   - Не возвращаться к generic helpers вроде `createAssetChild(...)` как основному API generated classes.

8. Обновить imports.
   - Class files импортируют только nested view classes и shared utils.
   - Class files не импортируют text registry и asset registry.
   - Asset registry импортируется только там, где нужен preload.

9. Проверить миграцию на одном реальном pack.
   - Один простой button.
   - Один обычный view с несколькими assets.
   - Один view с nested view/button.
   - Один view с несколькими text nodes.

10. Добавить smoke checks.
   - `node -c server/src/export/phaser-source-generator.js`.
   - In-memory generation проверяет, что нет imports из `[packName]/assets.ts` и `[packName].text.ts` во view class files.

## Важное решение

Новый план заменяет старую идею частичного class mode. Больше не нужно делить views на `class component` и `generic factory fallback`: все root views должны быть class files. Различаться будут только class templates и layout rules для разных структур view.
