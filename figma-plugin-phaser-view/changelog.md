# Changelog

Новые изменения добавляются сверху,  в том числе под той же датой - последние добавляются первыми

## 22.04.2026
- Runtime `GameObject.name` теперь получает точное имя Figma-объекта для view/button/text/assets; safe names остаются только для TypeScript identifiers.
- Button export теперь генерирует единый объект `[packCamel]Buttons` с ключами из точных Figma-имён, без отдельных button data const и factory-функций.
- Text export теперь генерирует единый объект `[packCamel]Texts` с ключами из точных Figma-имён, без отдельных text factory-функций, `baseText` и отдельных `localeMap` констант.
- Добавлен отдельный раздел `Button` в README: описаны `button*` как view container, nested button children и leaf `button*` без детей.
- Экспорт `button*` теперь поддерживает nested view children и leaf fallback: button без exportable children экспортирует сам node как single asset внутри button view.
- Generated runtime data теперь различает view children и asset children через `type: "view"` / `type: "asset"`.
- View теперь имеет уникальный name (поле объекта Phaser зарезервировано для таких случаев)
