# Figma Phaser View Export

Локальный Figma plugin для экспорта выбранного UI-узла в Phaser-friendly atlas и TypeScript-файлы.

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

1. Плагин экспортирует верхних детей выбранного Figma-узла в PNG.
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
- `code.js` - main thread: чтение selection, экспорт PNG, сбор manifest, `figma.clientStorage`.
- `ui.html` - UI: настройки, выбор путей, отправка экспорта на server.

### Companion server

- `server/package.json` - зависимости и npm scripts.
- `server/server.js` - HTTP server, packing atlas, генерация TS, запись файлов.
- `server/settings.local.json` - локальные пути экспорта, создается автоматически.

---

## Что экспортируется из Figma

Из выбранного корневого узла экспортируются:

- только верхние дети;
- только видимые верхние дети;
- каждый верхний ребенок как отдельный PNG;
- координаты относительно левого верхнего угла корневого узла.

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

Правило сбора:

- плагин ищет `view*` узлы на текущей странице, не заходя внутрь `assets*` frame;
- внутри каждого `view*` смотрит только детей верхнего уровня;
- если ребенок тоже начинается с `view`, он исследуется таким же образом;
- если ребенок не начинается с `view`, он копируется в `assets*` frame на свободное место.

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
  "warnings": {
    "unsafeNames": []
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
6. Plugin только выполнит диагностику: загрузит настройки, проверит server и selection, выведет лог.
7. Проверьте `atlasBasePath` и `serverUrl`.
8. Убедитесь, что на странице есть top-level `assets*` frame. Если его нет, нажмите `Ассеты`.
9. Нажмите `Экспорт`.

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

- Должен быть выбран ровно один корневой узел.
- Экспортируются только верхние дети выбранного узла.
- Скрытые узлы пропускаются.
- Figma plugin не пишет в файловую систему напрямую.
- Запись файлов выполняет только companion server.
- Текущая схема - ручной export по кнопке, не live-sync.

---

## Частые ошибки

### `Выберите ровно один корневой узел`

В Figma выделено 0 или больше 1 узла.

### `Выбранный узел не поддерживает children`

Выбран узел без дочерних слоев.

### `Не удалось экспортировать ни одного PNG`

Все верхние дети скрыты или не экспортировались.

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
- Экспорт вложенной структуры, а не только верхних детей.
