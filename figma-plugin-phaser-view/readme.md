# Figma Phaser View Export

Локальный Figma plugin для экспорта выбранного UI-узла в Phaser-friendly atlas и TypeScript-файлы.

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

`packName` по умолчанию берется из имени выбранного корневого узла, но его можно изменить в UI плагина.

---

## Настройки путей

В UI плагина задаются:

- `serverUrl` - адрес companion server, по умолчанию `http://localhost:3456`;
- `packName` - имя atlas pack;
- `atlasBasePath` - runtime URL для Phaser preload, например `./assets/atlases/`;
- `atlasOutputDir` - абсолютная папка на диске для atlas `.png/.json`;
- `tsOutputDir` - абсолютная папка на диске для `.ts` файлов.

Важно:

- `atlasBasePath` - путь загрузки внутри игры.
- `atlasOutputDir` - filesystem path, куда сервер пишет atlas.
- `tsOutputDir` - filesystem path, куда сервер пишет TypeScript.

Под кнопками задания путей UI показывает краткую версию пути через ellipsis. Полный путь доступен в tooltip.

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
GET http://localhost:3456/health
```

Настройки:

```text
GET  http://localhost:3456/settings
POST http://localhost:3456/settings
```

---

## Как пользоваться

1. Запустите server:

```bash
cd server
npm start
```

2. В Figma выберите ровно один корневой UI-узел.
3. Запустите plugin.
4. Дождитесь завершения экспорта PNG из Figma.
5. Проверьте `packName`, `atlasBasePath`, `serverUrl`.
6. Нажмите `Задать путь экспорта atlas` и укажите абсолютную папку для `.png/.json`.
7. Нажмите `Задать путь экспорта TS` и укажите абсолютную папку для `.ts`.
8. Нажмите `Экспортировать файлы`.

После этого server перезапишет atlas и TS-файлы в указанных папках.

---

## API server

### `GET /health`

Возвращает состояние server и текущие output paths.

### `GET /settings`

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

### `POST /settings`

Сохраняет пути:

```json
{
  "atlasOutputDir": "/path/to/public/assets/atlases",
  "tsOutputDir": "/path/to/src/autogen"
}
```

### `POST /export`

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
