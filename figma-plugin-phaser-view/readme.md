Ниже `readme.md` целиком.

Сделал уже под **текущую схему с companion server**, а не под старый ZIP-only вариант. За основу взял структуру и стиль твоего старого README.

````md id="d1j1um"
# Figma Phaser View Export

Локальный Figma plugin для экспорта UI-узлов в формат, удобный для Phaser.

Плагин берет один выбранный корневой узел в Figma, экспортирует его верхних детей в PNG, собирает `manifest.json` с координатами и отправляет данные в UI.  
Дальше UI умеет:

- собрать ZIP для ручного скачивания;
- отправить экспорт в локальный companion server;
- получить на выходе atlas (`png + json`) и TypeScript-файлы прямо в папке игры.

---

## Что делает проект

Проект состоит из двух частей:

### 1. Figma plugin
Отвечает за:
- чтение текущего выделения;
- экспорт PNG верхних детей выбранного узла;
- сбор `manifest.json` с координатами, размерами и метаданными;
- отображение UI;
- отправку результата на локальный сервер.

### 2. Companion server
Локальный Node.js сервер, который:
- принимает экспортированные PNG и manifest из плагина;
- упаковывает их в atlas через `free-tex-packer-core`;
- генерирует Phaser-совместимый atlas JSON;
- генерирует TypeScript-файлы;
- пишет все это прямо в папку игрового проекта.

---

## Структура проекта

Пример:

```text
figma-plugin-phaser-view/
  code.js
  manifest.json
  ui.html
  readme.md

  companion/
    package.json
    server.js
````

### Файлы плагина

* `manifest.json` — manifest Figma plugin
* `code.js` — main thread плагина, экспорт PNG и manifest из Figma
* `ui.html` — UI плагина, отправка на companion server, сборка ZIP
* `readme.md` — инструкция

### Файлы companion server

* `companion/package.json` — зависимости локального сервера
* `companion/server.js` — HTTP сервер для упаковки и генерации файлов

---

## Что экспортируется из Figma

Из выбранного корневого узла экспортируются:

* только **верхние дети**
* только **видимые** верхние дети
* каждый верхний ребенок экспортируется как отдельный PNG
* координаты считаются относительно левого верхнего угла корневого узла

Если имя узла заканчивается на:

```text
nine.<число>
```

то в `manifest.json` будет записано:

* `kind: "nine"`
* `ninePadding: <число>`

Пример:

```text
button.primary.nine.20
```

---

## Формат manifest.json

Пример:

```json
{
  "version": 1,
  "generatedAtIso": "2026-04-20T12:00:00.000Z",
  "root": {
    "nodeId": "3:469",
    "name": "main-ui",
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

## Безопасные имена файлов

Если имя корневого узла или верхнего ребенка содержит что-то кроме:

* латиницы
* цифр
* `.`
* `_`
* `-`

плагин показывает предупреждение в UI и пишет информацию в:

```json
manifest.warnings.unsafeNames
```

Экспорт при этом не останавливается.
Для итоговых файлов используется безопасный `slugify`.

---

## Что генерируется в игре

Companion server пишет в проект игры:

```text
public/assets/atlases/[packName].png
public/assets/atlases/[packName].json
src/autogen/[packName]-assets.ts
src/autogen/[packName]-scene.ts
src/autogen/types.ts
src/autogen/utils.ts
```

`packName` по умолчанию берется из имени выбранного корневого узла, но его можно изменить в UI плагина.

---

## Что есть в `[packName]-assets.ts`

Для каждого pack генерируются:

* `export const <packCamel>AutoAssetsConfig`
* `export function preload<PackPascal>Assets(scene)`
* `export const <packCamel>AutoAssets`
* `export const <packCamel>AutoAssetOrder`

### Пример

```ts
export function preloadCardsUiAssets(scene) {
  scene.load.atlas(
    "cards-ui",
    "./assets/atlases/cards-ui.png",
    "./assets/atlases/cards-ui.json"
  );
}
```

---

## Что есть в `[packName]-scene.ts`

Генерируется простая Phaser scene-заглушка, которая использует preload-функцию из `[packName]-assets.ts`.

Это не финальная игровая сцена, а автогенерируемая стартовая заготовка.

---

## Как это работает

Схема такая:

1. В Figma выбирается один корневой узел
2. `code.js` экспортирует верхних детей в PNG
3. `code.js` собирает `manifest.json`
4. данные передаются в `ui.html`
5. `ui.html` либо:

    * собирает ZIP
    * либо отправляет payload на `http://localhost:3456/export`
6. `server.js` принимает payload
7. `server.js` запускает `free-tex-packer-core`
8. `server.js` пишет atlas и TS-файлы в папку игры

---

## Установка плагина

### 1. Подготовить файлы плагина

Убедитесь, что в папке есть:

* `manifest.json`
* `code.js`
* `ui.html`

### 2. Подключить plugin в Figma

В Figma:

* `Plugins`
* `Development`
* `Import plugin from manifest...`

Выберите `manifest.json`.

---

## Настройка manifest.json

Для работы с локальным companion server в `manifest.json` должен быть разрешен localhost:

```json
{
  "networkAccess": {
    "allowedDomains": [
      "https://cdn.jsdelivr.net",
      "http://localhost:3456"
    ]
  }
}
```

---

## Установка companion server

Перейдите в папку `companion/` и установите зависимости:

```bash
npm install
```

Минимально нужен пакет:

```bash
npm install free-tex-packer-core
```

---

## Настройка server.js

В `server.js` надо поменять пути под свой проект:

```js
const GAME_ROOT_DIR = "/Users/sergeytokarev/work_my/YOUR_GAME_PROJECT";
const ATLAS_OUTPUT_DIR = path.join(GAME_ROOT_DIR, "public", "assets", "atlases");
const SCENE_OUTPUT_DIR = path.join(GAME_ROOT_DIR, "src", "autogen");
```

### Что это значит

* `GAME_ROOT_DIR` — корень проекта игры
* `ATLAS_OUTPUT_DIR` — куда писать atlas png/json
* `SCENE_OUTPUT_DIR` — куда писать TypeScript-файлы

---

## Запуск companion server

```bash
node server.js
```

Если все нормально, сервер поднимется на:

```text
http://localhost:3456
```

Проверка:

```text
GET http://localhost:3456/health
```

---

## Как пользоваться

### Вариант 1. Скачать ZIP

1. Выберите ровно один корневой узел в Figma
2. Запустите плагин
3. Дождитесь завершения экспорта
4. При необходимости поправьте `packName`
5. Нажмите `Скачать ZIP`

### Вариант 2. Синхронизировать в игру

1. Запустите companion server
2. Выберите ровно один корневой узел в Figma
3. Запустите плагин
4. Дождитесь завершения экспорта
5. При необходимости поправьте:

    * `packName`
    * `atlasBasePath`
6. Нажмите `Синхронизировать в игру`

После этого atlas и TS-файлы будут записаны прямо в проект игры.

---

## atlasBasePath

Поле `atlasBasePath` задается в UI плагина.

По умолчанию:

```text
./assets/atlases/
```

Этот путь попадает в генерируемый preload-код.

Пример:

```ts
scene.load.atlas(
  "cards-ui",
  "./assets/atlases/cards-ui.png",
  "./assets/atlases/cards-ui.json"
);
```

Важно:

* это **путь загрузки внутри игры**
* а не абсолютный путь на диске

---

## Ограничения

* экспортируются только верхние дети выбранного узла
* скрытые узлы пропускаются
* должен быть выбран ровно один корневой узел
* plugin не пишет в файловую систему напрямую
* запись в папку игры выполняет только companion server
* текущая схема — это ручной sync по кнопке, а не настоящий live background sync

---

## Частые ошибки

### `Выберите ровно один корневой узел`

Выделено 0 или больше 1 узла.

### `Выбранный узел не поддерживает children`

Выбран узел без children.

### `Не удалось экспортировать ни одного PNG`

Все дети были скрыты или не экспортировались.

### `Failed to fetch`

Плагин не смог достучаться до `http://localhost:3456/export`.

Проверь:

* запущен ли `server.js`
* правильный ли порт
* добавлен ли localhost в `manifest.json`

### `Packed atlas png was not produced`

Companion server не получил ожидаемый результат от `free-tex-packer-core`.

Обычно это значит:

* битые входные PNG
* некорректный формат payload
* проблема в настройках пакера

---

## Дев-цикл

Нормальный рабочий цикл такой:

1. меняешь layout в Figma
2. жмешь `Синхронизировать в игру`
3. companion server перезаписывает atlas и TS-файлы
4. dev-сборка игры подхватывает изменения
5. Phaser-сцена перезапускается вручную или через hot/dev-логику проекта

---

## Почему нужен companion server

Figma plugin умеет:

* читать документ
* экспортировать изображения
* показывать UI
* делать HTTP-запросы

Но он не должен напрямую работать как полноценный файловый инструмент для твоего игрового проекта.

Поэтому companion server берет на себя:

* упаковку atlas
* запись файлов
* интеграцию с локальной папкой игры

Это делает схему проще и надежнее.

---

## Примечание про окно плагина

Окно плагина можно двигать как плавающее, но закрепить как постоянную боковую панель Figma нельзя.

---

## Планы на будущее

Возможные следующие шаги:

* auto-sync по таймеру
* websocket-уведомления в игру
* авто-рестарт сцены
* генерация более полного Phaser runtime-слоя
* поддержка trim / nine-slice metadata / layout metadata
* экспорт не только верхних детей, но и вложенной структуры
