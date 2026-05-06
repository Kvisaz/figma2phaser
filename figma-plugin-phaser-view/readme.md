# Figma Phaser View Export

Локальный Figma plugin для экспорта Figma view в Phaser: plugin собирает atlas PNG/JSON и генерирует TypeScript-файлы с class components.

## Коротко

- Root export создается только из Figma-нод, имя которых начинается с `view` или `button`.
- Plugin смотрит детей первого уровня страницы и direct children фреймов, имя которых не начинается с `assets`.
- Внутрь групп на этапе поиска root plugin не проваливается: служебные button-like ассеты внутри групп не становятся отдельными root exports.
- После того как root `view/button` найден, его внутреннее дерево разбирается нормально: вложенные `view`, `button`, `text` и asset children сохраняют иерархию.
- Каждый `view*` / `button*` генерируется как отдельный `Phaser.GameObjects.Container` class в `[tsOutputDir]/[packName]/views/*.ts`.
- `[tsOutputDir]/[packName]/views/index.ts` является barrel-файлом и re-export-ит generated view classes.
- Generated view classes используют локальные text constants и inline asset data; они не импортируют `assets.ts` и отдельный text registry.
- `assets*` frame нужен для atlas assets. Он не является источником root view.
- Manifest сохраняет `children` как structured data, а generated classes превращают его в прямые Phaser constructors.

## План работ

Актуальный чеклист по class-only generation и output layout лежит в [todo.md](todo.md). Его нужно держать рядом с изменениями generator, чтобы контракт generated файлов не расходился с реализацией.

## Главные правила

- Экспорт переиспользует ассеты по имени: если в разных `view*` / `button*` встречаются дети с одинаковым именем, они считаются дублями одного ассета.
- При совпадении имени plugin может взять уже существующий asset из `assets*` frame, а не заново экспортировать child из View.
- Это текущий контракт, а не ошибка: одинаковые имена означают намеренное переиспользование одного atlas frame.
- `assets*` frame служит видимым контролем этого контракта: сразу видно, какие ассеты реально попали в pack и какие имена будут переиспользованы.
- `Экспорт` берет актуальные `x/y/width/height` ассетов из их текущей геометрии в `assets*` frame, поэтому можно вручную подрезать nine-slice текстуры и двигать ассеты без повторного пересчета из `view*` / `button*`.
- Если нужны два визуально разных ассета, им нужно дать разные имена в Figma.

## Быстрый старт

1. Запустите companion server:

```bash
cd server
npm start
```

2. Откройте страницу настроек:

```text
http://localhost:3456/
```

3. На странице выберите:

- `atlasOutputDir` - папку для atlas `.png/.json`;
- `tsOutputDir` - папку для сгенерированных TypeScript-файлов.

Выбор папок и ручное редактирование полей на server page сохраняются автоматически в `server/settings.local.json`.

Figma plugin эти пути только показывает компактным списком. Менять `atlasOutputDir` и `tsOutputDir` нужно через server page.

---

Проект работает через companion server:

1. Плагин находит `view*` / `button*` / `text*` деревья на текущей странице, собирает assets frame и экспортирует PNG.
2. UI плагина отправляет PNG, manifest и настройки на `http://localhost:3456`.
3. `server/server.js` пакует atlas через `free-tex-packer-core`.
4. Сервер пишет atlas PNG/JSON и TypeScript-файлы прямо в указанные папки игрового проекта.

ZIP-экспорт в этой схеме не используется.

---

## Структура

```text
figma-plugin-phaser-view/
  code.js
  manifest.json
  ui.html
  readme.md

  server/
    package.json
    server.js
    settings.local.json   # создается автоматически после сохранения путей
```

### Figma plugin

- `manifest.json` - manifest Figma plugin.
- `code.js` - main thread: page-level view export, сбор PNG, сбор manifest, `figma.clientStorage`.
- `ui.html` - UI: настройки, выбор путей, отправка экспорта на server.

### Companion server

- `server/package.json` - зависимости и npm scripts.
- `server/server.js` - HTTP server, packing atlas, генерация TS, запись файлов.
- `server/settings.local.json` - локальные пути экспорта, создается автоматически.

---

## Что экспортируется из Figma

Из текущей страницы экспортируются:

- root `view*` / `button*` из детей первого уровня страницы;
- root `view*` / `button*` из direct children фреймов, имя которых не начинается с `assets`;
- только видимые дети первого уровня у каждого `view*` / `button*`;
- если child тоже начинается с `view`, `button` или `text`, он обрабатывается как вложенный renderable child;
- каждый уникальный asset как отдельный PNG;
- для `manifest.items` и `[packName]/assets.ts` используются актуальные `x/y/width/height` детей `assets*` frame;
- координаты children в `views/*.ts` считаются относительно bounds соответствующего `view`.
- `name` из Figma ставится в `GameObject.name`.
- safe `functionName` используется для TypeScript identifiers generated classes и compatibility `createXxx(...)`.
- Каждый renderable `view*` / `button*` получает отдельный class file в `views/`.
- Вложенные `view*` / `button*` создаются как nested class instances, а не private builder-функциями.
- Text data кладется локально в файл view class и содержит только `localeMap` и `style`.
- Asset data копируется локально в файл view class; view files не импортируют `[packName]/assets.ts`.

Если имя узла заканчивается на:

```text
nine.<число>
```

то в manifest будет записано:

```json
{
  "kind": "nine",
  "ninePadding": 20
}
```

Пример имени:

```text
panel.bg.nine.20
```

---

## Button

Любой видимый узел, имя которого начинается с `button`, считается отдельным renderable view container:

- в `manifest.views` у него будет `"button": true`;
- для button генерируется отдельный class file в `views/`;
- если button вложен в другой `view*` / `button*`, parent class импортирует и создает его class instance;
- runtime setup выставит `this.setData("button", true)`;
- если такой узел лежит внутри `view*` или другого `button*`, parent получит child `{ type: "view", name, button, x, y, width, height, children }`, а не прямой asset child.

### Button с детьми

Если у `button*` есть видимые direct children, которые не начинаются с `view` или `button`, они экспортируются как обычные PNG assets и становятся children этого button view.

Пример Figma-структуры:

```text
viewMain
  buttonPlay
    button.play.bg.nine.20
    button.play.label
```

Ожидаемый runtime смысл:

- `ButtonPlay` генерируется как отдельный class;
- `ViewMain` импортирует `ButtonPlay` и создает его через `new ButtonPlay(...)`;
- direct children кнопки создаются внутри constructor класса `ButtonPlay`.

### Button без детей

Если `button*` является leaf node без exportable children, имя принадлежит самому объекту без детей. Plugin экспортирует этот же node как single PNG asset и кладет его внутрь auto-generated button view.

Пример Figma-структуры:

```text
viewMain
  buttonBack
```

Смысл generated data:

```ts
export const viewMainData = {
  name: "viewMain",
  width: 768,
  height: 485,
  children: {
    buttonBack: {
      type: "view",
      name: "buttonBack",
      button: true,
      x: 350,
      y: 260,
      width: 80,
      height: 80,
      children: {
        buttonBack: {
          asset: assetsCoreAutoAssets.buttonBack,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
        },
      },
    },
  },
};
```

В этом случае имя `buttonBack` используется в двух ролях:

- как ключ nested view child: `viewMainData.children.buttonBack`;
- как имя atlas asset: `assetsCoreAutoAssets.buttonBack`.

Это не конфликтует в TypeScript, потому что asset находится внутри объекта `assetsCoreAutoAssets`, а view child находится внутри `children`.

Если в `assets*` frame уже есть asset с таким же именем `buttonBack`, export возьмет PNG оттуда. Если такого asset нет, plugin склонирует сам `buttonBack` в `assets*` frame и экспортирует его.

Важно: prefix `button*` имеет semantic meaning. Если нужен обычный asset, который не должен становиться button view, не называйте его с prefix `button`.

---

## Text

Любой видимый `TEXT`-узел, имя которого начинается с `text`, считается отдельным renderable text view:

- в `manifest.views` у него будет `"kind": "text"`;
- отдельный `[packName].text.ts` больше не генерируется;
- тексты, используемые конкретным view class, кладутся локально перед class в одну константу `[viewCamel]Texts`;
- text data содержит только `localeMap` и `style`;
- координаты и размеры text child используются в constructor/layout code, а не в text data;
- generated class создает текст напрямую через `new Phaser.GameObjects.Text(...)`;
- из Figma в style попадают `fontFamily`, `fontSize`, `color`, `strokeThickness` и `stroke`;
- стартовая локаль берется из `props.locale ?? getSceneLocale(scene) ?? "ru"`.

---

## Generated view TS

Актуальный формат generated view code:

- каждый renderable `view*` / `button*` получает отдельный файл `[packName]/views/[ClassName].ts`;
- class extends `Phaser.GameObjects.Container`;
- `[packName]/views/index.ts` является barrel-файлом с re-export classes;
- view class files не импортируют `[packName]/assets.ts`;
- `[packName].text.ts` не генерируется;
- asset data копируется в локальную `[viewCamel]Assets` константу;
- text data копируется в локальную `[viewCamel]Texts` константу и содержит только `localeMap` и `style`;
- compatibility factory `createXxx(props)` может генерироваться рядом с class, но основной API - class.

Упрощенный пример:

```typescript
const buttonSelectStyleTexts = {
  textButtonGameStyle: {
    localeMap: {
      en: "Game style",
      ru: "Game style",
    },
    style: {
      fontSize: 20,
      color: "#fff",
    },
  },
} as const;

export class ButtonSelectStyle extends Phaser.GameObjects.Container {
  constructor(props: IButtonSelectStyleProps) {
    super(props.scene, 0, 0);
    const scene = props.scene;
    const locale = props.locale ?? getSceneLocale(scene) ?? "ru";
    const labelMap = buttonSelectStyleTexts.textButtonGameStyle.localeMap as Record<string, string>;
    const text = new Phaser.GameObjects.Text(scene, 0, 0, labelMap[locale] ?? "", buttonSelectStyleTexts.textButtonGameStyle.style);
    this.add(text);
  }
}
```

---

## Assets frame и кнопка `Ассеты`

На текущей странице должен быть top-level `FRAME`, имя которого начинается с:

```text
assets
```

Пример:

```text
assets-core
```

Кнопка `Ассеты`:

- всегда активна;
- ищет первый top-level `FRAME` с именем `assets*`;
- если такой frame найден, складывает копии в него;
- если такого frame нет, создает `assets-core` размером `1920x3600`;
- собирает ассеты из `view*` / `button*` / `text*` деревьев на текущей странице.
- над `assets*` frame создает или обновляет служебный text node `assets-about` с подсказкой: `1. можно менять размеры NineSlice`, `2. ассеты с одинаковыми именами заменяют друг друга`.

Правило сбора:

- плагин ищет `view*` / `button*` / `text*` узлы на текущей странице, не заходя внутрь `assets*` frame;
- внутри каждого `view*` / `button*` / `text*` смотрит только детей верхнего уровня;
- если ребенок тоже начинается с `view`, `button` или `text`, он исследуется как вложенный renderable child;
- если ребенок не начинается с `view`, `button` или `text`, он копируется в `assets*` frame на свободное место.
- `Экспорт` не пересчитывает размеры и позицию ассетов из `view*` / `button*` / `text*`; он использует текущую геометрию детей `assets*` frame.

Важно: `assets*` frame должен лежать на верхнем уровне страницы. Вложенный `assets*` frame сейчас не используется как целевой контейнер.

---

## Формат manifest

Пример:

```json
{
  "version": 1,
  "generatedAtIso": "2026-04-20T12:00:00.000Z",
  "packName": "cards-ui",
  "root": {
    "nodeId": "3:469",
    "name": "cards-ui",
    "width": 1280,
    "height": 720
  },
  "items": [
    {
      "nodeId": "3:470",
      "name": "panel.bg.nine.20",
      "fileName": "panel.bg.nine.20.png",
      "x": 120,
      "y": 220,
      "width": 256,
      "height": 96,
      "kind": "nine",
      "ninePadding": 20
    },
    {
      "nodeId": "3:471",
      "name": "buttonBack",
      "fileName": "button-back.png",
      "x": 420,
      "y": 220,
      "width": 80,
      "height": 80,
      "kind": "image"
    }
  ],
  "skipped": [],
  "views": [
    {
      "nodeId": "3:469",
      "name": "viewMain",
      "functionName": "viewMain",
      "x": 0,
      "y": 0,
      "width": 1280,
      "height": 720,
      "children": [
        {
          "type": "asset",
          "nodeId": "3:470",
          "name": "panel.bg.nine.20",
          "assetFileName": "panel.bg.nine.20.png",
          "x": 120,
          "y": 220,
          "width": 256,
          "height": 96
        },
        {
          "type": "view",
          "nodeId": "3:471",
          "name": "buttonBack",
          "viewNodeId": "3:471",
          "viewFunctionName": "buttonBack",
          "x": 20,
          "y": 20,
          "width": 80,
          "height": 80
        }
      ]
    },
    {
      "nodeId": "3:471",
      "name": "buttonBack",
      "functionName": "buttonBack",
      "button": true,
      "x": 20,
      "y": 20,
      "width": 80,
      "height": 80,
      "children": [
        {
          "type": "asset",
          "nodeId": "3:471",
          "name": "buttonBack",
          "assetFileName": "button-back.png",
          "x": 0,
          "y": 0,
          "width": 80,
          "height": 80
        }
      ]
    }
  ],
  "warnings": {
    "unsafeNames": [],
    "viewAssetLinks": []
  }
}
```

---

## Имена файлов

Безопасный формат имени:

- латиница;
- цифры;
- `.`;
- `_`;
- `-`.

Если имя корневого узла или верхнего ребенка содержит другие символы, плагин показывает предупреждение и пишет данные в:

```json
manifest.warnings.unsafeNames
```

Экспорт не останавливается. Для файлов используется безопасный `slugify`.

---

## Что генерируется

Сервер пишет:

```text
[atlasOutputDir]/[packName].png
[atlasOutputDir]/[packName].json
[tsOutputDir]/[packName]/assets.ts
[tsOutputDir]/[packName]/views/index.ts
[tsOutputDir]/[packName]/views/[ClassName].ts
[tsOutputDir]/[packName]/types.ts
[tsOutputDir]/[packName]/utils/utils.ts
[tsOutputDir]/[packName]/utils/scene-locale.ts
[tsOutputDir]/[packName]/utils/addButtonViewInteractivity.ts
```

`packName` по умолчанию берется из имени первого top-level `assets*` frame на текущей странице, но его можно отредактировать в UI plugin. Перед экспортом значение проходит безопасную `slugify`-обработку и используется как имя папки внутри `tsOutputDir`.

Пример:

```text
assets-core -> assets-core
Assets Core -> assets-core
assets/chibi core -> assets-chibi-core
```

Поле `packName` в UI редактируемое. Если поле пустое, plugin подставляет имя найденного `assets*` frame.

---

## Настройки

- `serverUrl` - адрес companion server, по умолчанию `http://localhost:3456`;
- `packName` - редактируемое имя atlas pack и папки generated TypeScript;
- `atlasBasePath` - runtime URL для Phaser preload, например `./assets/atlases/`;
- `atlasOutputDir` - абсолютная папка на диске для atlas `.png/.json`;
- `tsOutputDir` - абсолютная папка на диске для `.ts` файлов.

Важно:

- `atlasBasePath` - путь загрузки внутри игры.
- `atlasOutputDir` - filesystem path, куда сервер пишет atlas.
- `tsOutputDir` - filesystem path базовой папки, куда сервер пишет TypeScript в подпапку `[packName]`.

`atlasBasePath` и `serverUrl` задаются в Figma plugin.

`atlasOutputDir` и `tsOutputDir` задаются на главной странице server:

```text
http://localhost:3456/
```

Выбранные папки и ручные изменения input-полей автосохраняются на стороне server. Кнопка `Сохранить` нужна только для принудительного сохранения текущих значений.

Figma plugin только показывает эти пути read-only preview через ellipsis. Полный путь доступен в tooltip.

---

## Хранение настроек

Настройки сохраняются в двух местах:

- Figma plugin: через `figma.clientStorage`.
- Companion server: в `server/settings.local.json`.

Зачем два места:

- `figma.clientStorage` восстанавливает только UI-настройки плагина, например `packName`, `atlasBasePath` и `serverUrl`.
- `server/settings.local.json` хранит filesystem paths на стороне Node.js server, где реально есть доступ к диску.

Figma plugin не хранит и не отправляет `atlasOutputDir` / `tsOutputDir`. Он только показывает read-only preview этих путей, полученный из server.

---

## Установка плагина

В Figma:

1. `Plugins`.
2. `Development`.
3. `Import plugin from manifest...`.
4. Выберите `manifest.json`.

`manifest.json` должен разрешать localhost:

```json
{
  "networkAccess": {
    "allowedDomains": [
      "http://localhost:3456",
      "ws://localhost:3456"
    ]
  }
}
```

---

## Установка server

```bash
cd server
npm install
npm start
```

Проверка:

```text
GET http://localhost:3456/api/server/health
```

Главная страница настроек:

```text
http://localhost:3456/
```

API настроек:

```text
GET  http://localhost:3456/api/server/settings
POST http://localhost:3456/api/server/settings
```

---

## Как пользоваться

1. Запустите server:

```bash
cd server
npm start
```

2. Откройте страницу настроек server:

```text
http://localhost:3456/
```

3. Выберите папки `atlasOutputDir` и `tsOutputDir`.
4. В Figma откройте страницу, где лежат root `view*` / `button*` / `text*` и top-level `assets*` frame.
5. Запустите plugin.
6. Plugin выполнит диагностику: загрузит настройки, проверит server и текущую страницу, выведет лог.
7. Проверьте `atlasBasePath` и `serverUrl`.
8. Нажмите `Экспорт` - он возьмет актуальные размеры и позиции из `assets*` frame.

После этого server перезапишет atlas и TS-файлы в указанных папках.

---

## API server

### `GET /`

Главная HTML-страница настроек server.

### `GET /api/server/health`

Возвращает состояние server и текущие output paths.

### `GET /api/server/settings`

Возвращает сохраненные пути:

```json
{
  "ok": true,
  "settings": {
    "atlasOutputDir": "/path/to/public/assets/atlases",
    "tsOutputDir": "/path/to/src/autogen"
  }
}
```

### `POST /api/server/settings`

Сохраняет пути:

```json
{
  "atlasOutputDir": "/path/to/public/assets/atlases",
  "tsOutputDir": "/path/to/src/autogen"
}
```

### `POST /api/server/choose-directory`

Открывает системный выбор папки на стороне server и сохраняет выбранный путь. Если в payload переданы текущие `atlasOutputDir` и `tsOutputDir`, server сохраняет их вместе с выбранной папкой, чтобы не терять несохраненные изменения формы.

```json
{
  "kind": "atlas",
  "atlasOutputDir": "/current/atlas/path",
  "tsOutputDir": "/current/ts/path"
}
```

или:

```json
{
  "kind": "ts",
  "atlasOutputDir": "/current/atlas/path",
  "tsOutputDir": "/current/ts/path"
}
```

### `POST /api/server/validate-settings`

Проверяет, что папки заданы, существуют или могут быть созданы, и доступны для записи.

### `POST /api/figma/export`

Принимает:

```json
{
  "packName": "cards-ui",
  "atlasBasePath": "./assets/atlases/",
  "manifest": {},
  "files": [
    {
      "fileName": "button.play.png",
      "bytesBase64": "..."
    }
  ]
}
```

Пишет файлы на диск и возвращает список записанных файлов.

---

## Ограничения

- Основной сценарий - экспорт `view*` / `button*` деревьев с текущей страницы.
- Старый selection-based export сохранен только как legacy-функция в коде.
- Скрытые узлы пропускаются.
- Figma plugin не пишет в файловую систему напрямую.
- Запись файлов выполняет только companion server.
- Текущая схема - ручной export по кнопке, не live-sync.

---

## Частые ошибки

### `На текущей странице не найдено узлов, имя которых начинается с "view" или "button"`

На странице нет top-level или вложенных `view*` / `button*` узлов.

### `Не удалось экспортировать ни одного PNG`

Все найденные assets не экспортировались.

### `Failed to fetch`

Плагин не смог достучаться до server.

Проверьте:

- запущен ли `server/server.js`;
- совпадает ли порт в `serverUrl`;
- разрешен ли localhost в `manifest.json`.

### `Packed atlas png was not produced`

`free-tex-packer-core` не вернул ожидаемый PNG.

Возможные причины:

- битый входной PNG;
- неподдержанный формат payload;
- проблема в настройках packer.

---

## Следующие возможные улучшения

- Native directory picker на стороне server.
- Auto-sync по таймеру.
- WebSocket-событие для игры после успешного экспорта.
- Генерация более полного Phaser runtime-слоя.
