# Changelog

Новые изменения добавляются сверху,  в том числе под той же датой - последние добавляются первыми

## 22.04.2026
- Добавлен отдельный раздел `Button` в README: описаны `button*` как view container, nested button children и leaf `button*` без детей.
- Экспорт `button*` теперь поддерживает nested view children и leaf fallback: button без exportable children экспортирует сам node как single asset внутри button view.
- Generated runtime data теперь различает view children и asset children через `type: "view"` / `type: "asset"`.
- View теперь имеет уникальный name (поле объекта Phaser зарезервировано для таких случаев)
