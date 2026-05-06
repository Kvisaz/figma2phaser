# Changelog

Новые изменения добавляются сверху,  в том числе под той же датой - последние добавляются первыми

## 06.05.2026
- Зафиксировано: частично прозрачные/оборванные PNG в atlas могут быть результатом Figma export glitch или состояния source node в `assets*` frame; packer не триммит и не режет такие изображения (`allowTrim: false`).
- Generated view files больше не содержат helper factories `createView*` / `createButton*`; `views/index.ts` экспортирует только classes.
- В server settings добавлен режим export: `Экспорт атласов` сохраняет текущее поведение, `Экспорт PNG` пишет отдельные PNG в `[atlasOutputDir]/png/`.
- В PNG-режиме generated assets и view classes используют прямые PNG texture keys вместо atlas frame references.
- Generated TypeScript теперь складывается в отдельную папку pack: `[tsOutputDir]/[packName]/`.
- Asset registry генерируется как `assets.ts`; `views/index.ts` экспортирует view classes из `views/*.ts`.
- Preview scene file `[packName]-scene.ts` больше не генерируется.
- Root `view*` / `button*` генерируются как `Phaser.GameObjects.Container` classes с inline asset data и локальными text constants.
- Отдельный text registry больше не генерируется; text data во view содержит только `localeMap` и `style`.
- Shared runtime файлы теперь копируются как `types.ts` и `utils/*` внутрь pack-папки.
- `packName` разблокирован в UI plugin, сохраняется как UI-настройка и используется как имя pack-папки.
- Figma plugin больше не хранит и не отправляет filesystem paths; `atlasOutputDir` и `tsOutputDir` остаются server-owned настройками.
- Server settings page автосохраняет выбранные папки и ручные изменения полей.

## 22.04.2026
- View export теперь генерирует развернутые TS-функции создания view: экспортируемые `viewData` constants остаются в начале файла, а nested view/button helpers получают parent-prefixed имена.
- Runtime `GameObject.name` теперь получает точное имя Figma-объекта для view/button/text/assets; safe names остаются только для TypeScript identifiers.
- Text export теперь генерирует единый объект `[packCamel]Texts` с ключами из точных Figma-имён, без отдельных text factory-функций, `baseText` и отдельных `localeMap` констант.
- Добавлен отдельный раздел `Button` в README: описаны `button*` как view container, nested button children и leaf `button*` без детей.
- Экспорт `button*` теперь поддерживает nested view children и leaf fallback: button без exportable children экспортирует сам node как single asset внутри button view.
- Generated runtime data теперь различает view children и asset children через `type: "view"` / `type: "asset"`.
- View теперь имеет уникальный name (поле объекта Phaser зарезервировано для таких случаев)
