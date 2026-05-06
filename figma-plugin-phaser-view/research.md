# Что еще можно придумать для улучшения генерации

## Короткий вывод

Текущая генерация уже стала достаточно понятной: есть root `view/button`, есть вложенные data-объекты, есть `rootRef` для переиспользования root view. Следующий полезный шаг - не усложнять архитектуру, а добавить несколько маленьких возможностей, которые уменьшают ручной код после генерации.

Самая перспективная идея: сделать для текстов похожий механизм переиспользования, но не как отдельные root factory-функции для каждого текста, а как простой runtime override текста в конкретном месте вызова.

## 1. Переиспользуемые текстовые шаблоны с локальным значением

### Проблема

Сейчас каждый text child хранит конкретный текст:

```ts
textGoldShopTitle: {
  type: "text",
  text: assetsViewsTexts["textGoldShopTitle"],
  x: 536,
  y: 6,
  width: 425,
  height: 58,
}
```

Это хорошо для статичных надписей, но хуже для повторяющихся UI-паттернов:

- цена товара;
- количество монет;
- имя игрока;
- таймер;
- счетчик прогресса;
- одинаковая кнопка с разной подписью.

Если дизайн текста одинаковый, а значение разное, хочется переиспользовать стиль и геометрию, но передавать конкретный текст в месте применения.

### Минимальная идея

Добавить в generated factory-функцию необязательный параметр `texts`, где ключ - имя text node, значение - runtime text override.

Пример желаемого кода:

```ts
export function viewGoldShop(
  scene: Phaser.Scene,
  texts = {},
): Phaser.GameObjects.Container {
  const view = createContainerFromViewData(scene, viewGoldShopData);

  const textgoldshoptitleChild = createTextChild(
    scene,
    viewGoldShopData.children.textGoldShopTitle,
    texts.textGoldShopTitle,
  );
}
```

Тогда пользовательский код может писать:

```ts
const view = viewGoldShop(scene, {
  textGoldShopTitle: "Получить золото",
  textGoldShopItemSmallValue: "55",
});
```

### Почему это KISS

- Не нужны отдельные text root functions.
- Не нужно менять Figma naming model.
- Не нужно вводить сложные binding-системы.
- Generated data остается простой константой без типизации.
- Вся логика override живет рядом с уже существующим `createTextChild`.

### Осторожность

Нельзя ломать текущий контракт, где `assetsViewsTexts[...]` остается дефолтным значением. Override должен быть только дополнительным:

```ts
createTextChild(scene, data, overrideText)
```

Если `overrideText === undefined`, используется старое значение из data.

### Возможная форма данных

Самый простой вариант:

```ts
export type ViewTextOverrides = {
  [key: string]: string;
};
```

Но для generated-файла лучше не типизировать саму data-константу. Тип можно держать в `utils.ts` или рядом с helper:

```ts
export type AutoViewTextOverrides = Record<string, string>;
```

Это не нарушает правило про generated data: `Record` не применяется к data-константам, а только к helper API.

### Проблема повторяющихся text names

Внутри одного root могут повторяться одинаковые text names в разных вложенных view. Например:

```ts
viewGoldShopItemSmallValue.children.textGoldShopItemSmallValue
viewGoldShopItemReward.children.viewGoldShopItemSmallValue.children.textGoldShopItemSmallValue
```

Если override keyed только по имени, одно значение применится ко всем таким текстам. Иногда это удобно, иногда нет.

Минимальный и надежный подход:

- по умолчанию override по имени Figma node;
- если нужны разные значения для одинаковых имен, позже добавить path-key.

Пример path-key:

```ts
{
  "viewGoldShopItemSmall.viewGoldShopItemSmallValue.textGoldShopItemSmallValue": "55",
  "viewGoldShopItemReward.viewGoldShopItemSmallValue.textGoldShopItemSmallValue": "10",
}
```

KISS-решение на первый шаг: начать только с коротких имен. Path-key добавить только если реальная генерация покажет боль.

## 2. Сократить шум generated factory-кода через локальные data aliases

### Проблема

Сейчас код очень длинный:

```ts
viewGoldShopData.children.viewGoldShopItemReward.children.buttonGoldShopItemReward.children.textBtGoldShopItemBtReward
```

Это корректно, но тяжело читать.

### Вариант

При входе в каждый nested container генерировать короткий alias:

```ts
const viewGoldShopItemRewardData = viewGoldShopData.children.viewGoldShopItemReward;
const viewgoldshopitemrewardChild = createContainerFromViewData(scene, viewGoldShopItemRewardData);
```

И дальше:

```ts
const buttonGoldShopItemRewardData = viewGoldShopItemRewardData.children.buttonGoldShopItemReward;
```

### Риск

Мы уже убирали лишние строки вида `const childData = ...`, потому что они раздражали и не давали пользы. Поэтому этот пункт спорный.

### Вывод

Не делать сейчас. Вернуться только если generated-файл станет реально неудобно отлаживать. Текущая явность лучше, чем лишние переменные.

## 3. Опции root factory-функции вместо разрозненных параметров

### Проблема

Если добавить `texts`, потом может понадобиться:

- initial visibility;
- callback hooks;
- locale;
- scale;
- interactive options;
- debug names.

Если добавлять параметры по одному, сигнатура расползется.

### Минимальная форма

```ts
export function viewGoldShop(
  scene: Phaser.Scene,
  options: AutoViewCreateOptions = {},
): Phaser.GameObjects.Container {
}
```

Где:

```ts
export type AutoViewCreateOptions = {
  texts?: Record<string, string>;
};
```

### Почему лучше

- Один расширяемый параметр.
- Старый вызов `viewGoldShop(scene)` не ломается.
- Новые возможности добавляются без изменения порядка аргументов.

### Вывод

Если делать override текстов, лучше сразу через `options.texts`, а не вторым параметром `texts`.

## 4. Возвращать references на важные children

### Проблема

Сейчас factory возвращает только root container:

```ts
const view = viewGoldShop(scene);
```

Чтобы найти кнопку или текст, пользователь должен искать по имени или руками проходить children.

### Идея

Возвращать container, но навесить на него map:

```ts
view.setData("refs", {
  buttonBack: buttonbackChild,
  textGoldShopTitle: textgoldshoptitleChild,
});
```

Или helper:

```ts
export function getAutoViewRefs(view: Phaser.GameObjects.Container) {
  return view.getData("refs");
}
```

### Риск

Это добавит runtime data и усложнит generated code. Плюс нужно решить, что делать с повторяющимися именами.

### KISS-вывод

Пока не делать глобально. Возможно, добавить только для rootRef и direct button children, потому что именно они чаще нужны в игровом коде.

## 5. Генерировать имена переменных стабильнее и читабельнее

### Проблема

Сейчас переменные вроде:

```ts
const textgoldshopitemsmallvalueChild2 = ...
```

работают, но не очень приятны для чтения.

### Идея

Сохранять camelCase с исходной капитализацией лучше:

```ts
const textGoldShopItemSmallValueChild2 = ...
```

### Польза

- Легче читать generated code.
- Легче искать переменные глазами.
- Меньше ощущения, что код "сломанный", хотя он корректный.

### Риск

Низкий. Это косметика генератора, на runtime не влияет.

### Приоритет

Средний. Делать после текстовых override.

## 6. Диагностика конфликтов имен

### Проблема

Сейчас одинаковые имена assets intentionally переиспользуются. Это правильно, но иногда одинаковое имя может быть ошибкой.

### Идея

В лог export добавить диагностику:

```text
INFO duplicate asset name: coin used 4 times
INFO duplicate view child name collapsed: viewGoldShopItemSmallValue
WARN duplicate root name: buttonBack
```

### KISS-форма

Не блокировать экспорт. Просто писать понятный список:

- duplicate assets;
- duplicate nested child names;
- duplicate root candidates;
- ignored frame names;
- ignored non-root groups.

### Польза

Пользователь быстрее понимает, почему generator сделал именно такой output.

### Приоритет

Высокий, потому что это снижает риск "магического" поведения без сложной архитектуры.

## 7. Явные markers вместо угадывания по имени

### Проблема

Сейчас вся семантика держится на prefix:

- `view`;
- `button`;
- `text`;
- `assets`.

Это просто и удобно, но naming mistakes могут создавать странный output.

### Идея

Когда-нибудь добавить поддержку plugin data или специальных markers:

```text
@view
@button
@asset
@ignore
```

### Почему не сейчас

Это усложняет UX и требует нового editing workflow в Figma. Prefix naming пока достаточно прост и прозрачен.

### Вывод

Не делать сейчас. Оставить как будущий путь, если naming-подход начнет мешать.

## 8. Ignore-механизм для служебных слоев

### Проблема

На странице могут быть группы, черновики, копии, визуальные подсказки. Сейчас root parsing уже ограничен, но внутри найденного root все видимые children могут попасть в export.

### Минимальная идея

Поддержать prefix:

```text
ignore.
_ignore.
```

или suffix:

```text
.ignore
```

### Риск

Нужно не конфликтовать с реальными asset names.

### Вывод

Полезно, но не срочно. Сначала достаточно строгого root parsing и `assets*` frame.

## 9. Разделить generated code на "data" и "build" файлы

### Проблема

Один generated `*.view.ts` быстро становится большим: data-константы и factory-функции смешаны.

### Возможный output

```text
assets-views.view-data.ts
assets-views.view.ts
```

Где:

- `view-data.ts` содержит только константы;
- `view.ts` содержит imports, factory-функции и сборку Phaser objects.

### Плюсы

- Data проще читать и diff-ить.
- Build code проще тестировать.
- Меньше шума в одном файле.

### Минусы

- Больше файлов.
- Больше imports.
- Не факт, что это реально нужно на текущем масштабе.

### Вывод

Не делать первым. Вернуться, если generated файл станет слишком большим для IDE.

## 10. Главный рекомендуемый план улучшений

### Шаг 1. Добавить `options.texts`

Минимальный generated API:

```ts
export function viewGoldShop(
  scene: Phaser.Scene,
  options: AutoViewCreateOptions = {},
): Phaser.GameObjects.Container {
  const view = createContainerFromViewData(scene, viewGoldShopData);

  const textgoldshoptitleChild = createTextChild(
    scene,
    viewGoldShopData.children.textGoldShopTitle,
    options.texts?.textGoldShopTitle,
  );
}
```

Helper:

```ts
export type AutoViewCreateOptions = {
  texts?: Record<string, string>;
};
```

`createTextChild`:

```ts
export function createTextChild(scene, data, overrideText) {
  const text = overrideText ?? data.text;
}
```

### Шаг 2. Добавить диагностику duplicate/ignored nodes

Не менять output, только улучшить объяснимость export.

### Шаг 3. Улучшить variable names

Косметика, но сильно улучшает чтение generated code.

## Итог

Самое полезное улучшение по балансу KISS/TRIZ/удобство - `options.texts` для root factory-функций.

Это решает реальную задачу: один и тот же Figma layout может использоваться с разными runtime-значениями без ручной правки generated files. При этом не нужно создавать отдельные text factory-функции и не нужно ломать текущую модель data-констант.

TRIZ-смысл: отделяем стабильное от изменяемого. Геометрия, стиль и иерархия остаются в generated data; конкретное значение текста становится runtime-параметром.
