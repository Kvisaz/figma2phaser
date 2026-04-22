# Figma Phaser View Export

Локальный Figma plugin для page-level экспорта `view*` деревьев в Phaser-friendly atlas и TypeScript-файлы.

## Особенности

- Экспорт переиспользует ассеты по имени: если в разных `view*` встречаются дети с одинаковым именем, они считаются дублями одного ассета.
- При совпадении имени plugin может взять уже существующий asset из `assets*` frame, а не заново экспортировать child из View.
- Это текущий контракт, а не ошибка: одинаковые имена означают намеренное переиспользование одного atlas frame.
- `assets*` frame служит видимым контролем этого контракта: сразу видно, какие ассеты реально попали в pack и какие имена будут переиспользованы.
- `Экспорт` берет актуальные `x/y/width/height` ассетов из их текущей геометрии в `assets*` frame, поэтому можно вручную подрезать nine-slice текстуры и двигать ассеты без повторного пересчета из `view*`.
- Если нужны два визуально разных ассета, им нужно дать разные имена в Figma.
- Рекурсивная обработка `view*` допускается: вложенный объект с именем `view*` может обрабатываться как отдельный View, а не как обычный asset child.

## Быстро: настройки server

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

Figma plugin эти пути только показывает компактным списком. Менять `atlasOutputDir` и `tsOutputDir` нужно через server page.

---

Проект работает через companion server:

1. Плагин находит `view*` деревья на текущей странице, собирает assets frame и экспортирует PNG.
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

- все `view*` узлы, найденные на странице;
- только видимые дети первого уровня у каждого `view*`;
- если child тоже начинается с `view`, он обрабатывается как отдельный view;
- каждый уникальный asset как отдельный PNG;
- для `manifest.items` и `[packName]-assets.ts` используются актуальные `x/y/width/height` детей `assets*` frame;
- координаты children в `*.view.ts` считаются относительно bounds соответствующего `view`.
- в `*.view.ts` у `IAutoViewData` есть safe `name`, совпадающий с `functionName`; runtime `createView()` ставит его в `container.name`.

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
button.primary.nine.20
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
- собирает ассеты из `view*` деревьев на текущей странице.
- над `assets*` frame создает или обновляет служебный text node `assets-about` с подсказкой: `1. можно менять размеры NineSlice`, `2. ассеты с одинаковыми именами заменяют друг друга`.

Правило сбора:

- плагин ищет `view*` узлы на текущей странице, не заходя внутрь `assets*` frame;
- внутри каждого `view*` смотрит только детей верхнего уровня;
- если ребенок тоже начинается с `view`, он исследуется таким же образом;
- если ребенок не начинается с `view`, он копируется в `assets*` frame на свободное место.
- `Экспорт` не пересчитывает размеры и позицию ассетов из `view*`; он использует текущую геометрию детей `assets*` frame.

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
      "name": "button.play.nine.20",
      "fileName": "button.play.nine.20.png",
      "x": 120,
      "y": 220,
      "width": 256,
      "height": 96,
      "kind": "nine",
      "ninePadding": 20
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
      "children": []
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
[tsOutputDir]/[packName]-assets.ts
[tsOutputDir]/[packName]-scene.ts
[tsOutputDir]/[packName].view.ts
[tsOutputDir]/types.ts
[tsOutputDir]/utils.ts
```

`packName` берется из имени первого top-level `assets*` frame на текущей странице и проходит безопасную `slugify`-обработку.

Пример:

```text
assets-core -> assets-core
Assets Core -> assets-core
assets/chibi core -> assets-chibi-core
```

Поле `packName` в UI read-only. Его нельзя задавать вручную, чтобы не перезаписать файлы другого документа старым сохраненным значением.

---

## Настройки

- `serverUrl` - адрес companion server, по умолчанию `http://localhost:3456`;
- `packName` - read-only имя atlas pack из первого top-level `assets*` frame;
- `atlasBasePath` - runtime URL для Phaser preload, например `./assets/atlases/`;
- `atlasOutputDir` - абсолютная папка на диске для atlas `.png/.json`;
- `tsOutputDir` - абсолютная папка на диске для `.ts` файлов.

Важно:

- `atlasBasePath` - путь загрузки внутри игры.
- `atlasOutputDir` - filesystem path, куда сервер пишет atlas.
- `tsOutputDir` - filesystem path, куда сервер пишет TypeScript.

`atlasBasePath` и `serverUrl` задаются в Figma plugin.

`atlasOutputDir` и `tsOutputDir` задаются на главной странице server:

```text
http://localhost:3456/
```

Figma plugin только показывает эти пути read-only preview через ellipsis. Полный путь доступен в tooltip.

---

## Хранение настроек

Настройки сохраняются в двух местах:

- Figma plugin: через `figma.clientStorage`.
- Companion server: в `server/settings.local.json`.

Зачем два места:

- `figma.clientStorage` восстанавливает UI-настройки при следующем запуске плагина.
- `server/settings.local.json` хранит filesystem paths на стороне Node.js server, где реально есть доступ к диску.

Если server не запущен, UI все равно может восстановить последние настройки из Figma. Когда server снова доступен, настройки синхронизируются.

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
4. В Figma выберите ровно один корневой UI-узел.
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

Открывает системный выбор папки на стороне server и сохраняет выбранный путь.

```json
{
  "kind": "atlas"
}
```

или:

```json
{
  "kind": "ts"
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
  "atlasOutputDir": "/path/to/public/assets/atlases",
  "tsOutputDir": "/path/to/src/autogen",
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

- Основной сценарий - экспорт `view*` деревьев с текущей страницы.
- Старый selection-based export сохранен только как legacy-функция в коде.
- Скрытые узлы пропускаются.
- Figma plugin не пишет в файловую систему напрямую.
- Запись файлов выполняет только companion server.
- Текущая схема - ручной export по кнопке, не live-sync.

---

## Частые ошибки

### `На текущей странице не найдено узлов, имя которых начинается с "view"`

На странице нет top-level или вложенных `view*` узлов.

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
