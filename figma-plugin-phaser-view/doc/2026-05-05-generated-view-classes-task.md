# Task: перейти на class-only Phaser view generation

## Контекст

Сейчас `server/src/export/phaser-source-generator.js` генерирует общий `[packName].view.ts`, где root views представлены data-константами и factory-функциями:

```ts
export const buttonData = {
  children: {
    bg: {
      asset: packAutoAssets.bg,
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    },
    textLabel: {
      text: packTexts.textLabel,
      x: 10,
      y: 20,
    },
  },
};

export function createButton(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const view = createContainerFromViewData(scene, buttonData);
  const bg = createAssetChild(scene, buttonData.children.bg);
  const text = createTextChild(scene, buttonData.children.textLabel);
  view.add([bg, text]);
  return view;
}
```

Новый целевой контракт другой:

- каждый root view генерируется как отдельный class file;
- все views генерируются как классы, а не как generic factory functions;
- тексты больше не выносятся в общий `[packName].text.ts`;
- asset registry file остается, но view classes не импортируют его и не ссылаются на его константы.

## Цель

Сделать генерацию такой формы:

```ts
const buttonSelectStyleTexts = {
  textButtonGameStyle: {
    localeMap: {
      en: "Game style",
      ru: "Стиль игры",
    },
    style: {
      fontFamily: "Arial",
      fontSize: 32,
      color: "#ffffff",
    },
  },
} as const;

const buttonSelectStyleAssets = {
  bg: {
    name: "ui.button.yellow.height82.nine.30",
    url: "./assets/atlases/assets-core.png",
    frameName: "ui.button.yellow.height82.nine.30.png",
    width: 320,
    height: 82,
    kind: "nine",
    ninePadding: 30,
  },
} as const;

export interface IButtonSelectStyleProps {
  readonly scene: Phaser.Scene;
  readonly width?: number;
  readonly height?: number;
  readonly fontSize?: number;
  readonly locale?: string;
}

export class ButtonSelectStyle extends Phaser.GameObjects.Container {
  constructor(protected props: IButtonSelectStyleProps) {
    super(props.scene, 0, 0);
    // direct constructors, local text constants, inline asset data
  }
}
```

## Output Structure

Recommended target:

```text
[tsOutputDir]/[packName]/assets.ts
[tsOutputDir]/[packName]/types.ts
[tsOutputDir]/[packName]/utils/utils.ts
[tsOutputDir]/[packName]/utils/scene-locale.ts
[tsOutputDir]/[packName]/utils/addButtonViewInteractivity.ts
[tsOutputDir]/[packName]/views/index.ts
[tsOutputDir]/[packName]/views/ButtonSelectStyle.ts
[tsOutputDir]/[packName]/views/ViewShop.ts
```

`[packName]/views/index.ts` re-exports generated view classes:

```ts
export { ButtonSelectStyle } from "./ButtonSelectStyle";
export { ViewShop } from "./ViewShop";
```

`[packName]-scene.ts` and root `[packName].view.ts` are not generated.

## Core Requirements

### 1. All root views become class files

`buildViewsTs(...)` should no longer return one large string for all views.

Instead, generation should produce multiple output files:

```js
{
  viewFiles: [
    {
      relativePath: "views/ButtonSelectStyle.ts",
      code: "...",
    },
    {
      relativePath: "views/ViewShop.ts",
      code: "...",
    },
  ],
  viewIndexTs: "optional barrel code",
}
```

`buildPhaserSceneSources(...)` and `writeExportFiles(...)` must be updated to write this file list.

### 2. No separate text registry file

Do not generate `[packName].text.ts` for the new class output.

For every root view file:

- collect all text nodes used by that root view tree;
- generate one local text constant before the class;
- keep only `localeMap` and `style` in text data;
- do not include `name`, `x`, `y`, `width`, `height` inside text data.

Example:

```ts
const buttonSelectStyleTexts = {
  textButtonGameStyle: {
    localeMap: {
      en: "Game style",
      ru: "Стиль игры",
    },
    style: {
      fontSize: 32,
      color: "#ffffff",
    },
  },
} as const;
```

Coordinates remain part of generated constructor/layout code, not text data.

### 3. Asset registry remains, but view classes inline asset data

`[packName]/assets.ts` remains useful for:

- atlas preload;
- debugging generated atlas metadata;
- possible external game code.

But generated view class files must not import it.

Bad:

```ts
import { assetsCoreAutoAssets } from "../assets";

const bgAsset = assetsCoreAutoAssets.uiButtonYellow;
```

Good:

```ts
const bgAsset = {
  name: "ui.button.yellow.height82.nine.30",
  url: "./assets/atlases/assets-core.png",
  frameName: "ui.button.yellow.height82.nine.30.png",
  width: 320,
  height: 82,
  kind: "nine",
  ninePadding: 30,
} as const;
```

This means `buildViewEntries(...)` should still resolve asset metadata through `assetEntries`, but `buildViewClassFile(...)` should serialize that metadata directly into the class file.

### 4. Nested views are also classes

Nested `view*` / `button*` children should be generated as classes too.

There are two acceptable approaches:

1. Generate a class file for every renderable view node, including nested views.
2. Generate one root file that contains root class plus private nested classes used only by that root.

Recommended first implementation: generate class files for every renderable `view*` / `button*`, then root files import nested classes.

Reason: this keeps classes reusable and avoids very large root files.

### 5. Direct constructors instead of generic creation helpers

Generated class constructors should create Phaser objects directly:

```ts
const bg = new Phaser.GameObjects.NineSlice(...);
const image = new Phaser.GameObjects.Image(...);
const text = new Phaser.GameObjects.Text(...);
```

Do not use these helpers as the primary generated API:

- `createContainerFromViewData(...)`;
- `createAssetChild(...)`;
- `createTextChild(...)`;
- generic `createView(...)`.

Low-level layout helpers are still acceptable when they make class code clearer:

- `center(...)`;
- `setLeftTop(...)` if still needed for Figma top-left placement;
- `makeContainerInteractive(...)`;
- locale helpers.

### 6. Templates are explicit files

Do not embed large TypeScript templates as JS template strings in `phaser-source-generator.js`.

Recommended structure:

```text
server/src/export/templates/
  view-class.ts.tpl
  view-index.ts.tpl
```

Use a simple local renderer first:

```js
function renderTemplate(templateName, values) {
  const template = readTemplateFile(templateName);
  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : "";
  });
}
```

Keep branching logic in JS. Template files should receive prepared strings:

- `imports`;
- `textConstants`;
- `assetConstants`;
- `propsInterface`;
- `className`;
- `constructorBody`.

### 7. Props and compatibility

Every generated class should accept at least:

```ts
export interface IButtonSelectStyleProps {
  readonly scene: Phaser.Scene;
}
```

Specialized templates may add props:

- `width?`;
- `height?`;
- `fontSize?`;
- `locale?`;

Helper factories `createView*` / `createButton*` are not generated. The public API is the class export itself.

## Implementation Plan

1. Update generated file path model.
   - Add support for writing multiple generated view files.
   - Update `buildOutputFilePaths(...)` / `writeExportFiles(...)` accordingly.

2. Add template infrastructure.
   - Add `server/src/export/templates/`.
   - Add `renderTemplate(...)`.
   - Add `view-class.ts.tpl`.
   - Add optional `view-index.ts.tpl`.

3. Replace text registry generation.
   - Stop generating `[packName].text.ts` for class output.
   - Add per-view text collection.
   - Serialize local `const [viewCamel]Texts = { ... } as const`.

4. Inline asset data into view files.
   - Keep `[packName]/assets.ts`.
   - Remove imports from asset registry in view class files.
   - Serialize each used asset child directly into local constants or direct constructor code.

5. Generate classes for all renderable views.
   - Root views become public exported classes.
   - Nested views become exported classes too, or private classes inside the root file if a view is root-local.
   - Constructors create direct Phaser objects.

6. Generate imports per file.
   - Import nested view classes only when needed.
   - Import shared utils only when used.
   - Do not import `[packName]/assets.ts` or `[packName].text.ts`.

7. Update docs.
   - README generated files section.
   - README text section.
   - README view generation section.

8. Add smoke checks.
   - `node -c server/src/export/phaser-source-generator.js`.
   - In-memory generation with assertions:
     - multiple view files are produced;
     - no view file imports `[packName]/assets.ts`;
     - no view file imports `[packName].text.ts`;
     - text constants contain only `localeMap` and `style`.

## Acceptance Criteria

1. Every generated root `view*` / `button*` has its own class file.
2. Generated view classes extend `Phaser.GameObjects.Container`.
3. `[packName].text.ts` is not generated for the new class output.
4. Text constants are local to the view file and contain only `localeMap` and `style`.
5. `[packName]/assets.ts` is still generated.
6. Generated view class files do not import `[packName]/assets.ts`.
7. Generated view class files do not reference `[packCamel]AutoAssets`.
8. Asset data used by a view is inlined into that view file.
9. Generated class constructors use direct Phaser constructors for image, nine-slice, and text.
10. Nested views are instantiated as classes, not built through generic factory helpers.
11. README points to `todo.md` and describes the new planned output shape.
12. `packName` is editable in plugin UI and is used as the TypeScript output folder name.
13. `[packName]-scene.ts` is not generated.
14. Helper factories `createView*` / `createButton*` are not generated.

## Important Notes

This is a replacement of the previous partial component-mode plan.

Old idea:

- generate class only for simple button-like components;
- keep generic factory fallback for complex views;
- keep shared text registry and asset registry imports.

New idea:

- generate classes for all views;
- use separate files per view;
- keep text data local to each view file;
- keep asset registry for preload/metadata, but inline asset data in view classes.
