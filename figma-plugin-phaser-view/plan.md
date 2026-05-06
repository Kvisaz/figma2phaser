# План: private builders вместо длинной развертки root view

## Главная проблема

Текущий generated code разворачивает все nested дерево внутри root factory-функции. Из-за этого root `view` вручную собирает не только direct children, но и grandchildren, great-grandchildren и так далее.

Это неправильно по ответственности:

- родительский view начинает знать внутренности всех вложенных view;
- property path становится чудовищно длинным;
- код тяжело читать и отлаживать;
- любая новая возможность увеличивает уже раздутую root factory-функцию.

Пример проблемы:

```ts
const textChild = createTextChild(
  scene,
  viewGoldShopData.children.viewGoldShopItemReward.children.buttonGoldShopItemReward.children.textBtGoldShopItemBtReward,
);
```

Root `viewGoldShop` не должен знать, что внутри `buttonGoldShopItemReward` лежит `textBtGoldShopItemBtReward`. Это ответственность builder-функции самого `buttonGoldShopItemReward`.

## Решение

Генерировать private builder-функции для каждого nested `view/button`.

Правило:

- `export function` создается только для root `view/button`;
- каждый nested `view/button` получает локальную `function buildXxx(...)`;
- каждый builder собирает только свои direct children;
- parent вызывает builder для direct nested child;
- parent не разворачивает внутренности nested child.

Это сохраняет generated code явным, но убирает длинные цепочки.

## Важное правило про имена

Генератор не должен разруливать дубли имен private builder-функций.

Если в Figma есть два nested `view/button`, которые дают одинаковое имя builder-функции, generated TypeScript должен честно показать конфликт имен. Это проблема Figma-структуры, а не генератора.

Оператор экспорта должен увидеть конфликт и исправить Figma:

- переименовать один из nested `view/button`;
- или вынести повторяемый элемент в root `view/button`;
- или явно изменить структуру так, чтобы имена были уникальны.

Почему так лучше:

- не появляются неожиданные `buildSomething2`;
- generated code остается предсказуемым;
- Figma остается источником истины;
- оператор видит проблему в дизайне, а не получает скрытую автоматическую подмену имен.

## Целевой generated code

### Root data остается как сейчас

```ts
export const viewGoldShopData = {
  name: "viewGoldShop",
  width: 1496,
  height: 620,
  children: {
    buttonBack: {
      type: "view",
      rootRef: "buttonBack",
      x: 1411,
      y: 13,
      width: 75,
      height: 80,
    },
    viewGoldShopItemReward: {
      type: "view",
      name: "viewGoldShopItemReward",
      x: 40,
      y: 80,
      width: 320,
      height: 510,
      children: {
        // nested children
      },
    },
  },
};
```

Generated data-константа остается без явной типизации. `children` остается object literal, чтобы IDE видела поля.

### Root factory собирает только direct children

```ts
export function viewGoldShop(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const view = createContainerFromViewData(scene, viewGoldShopData);

  const buttonbackChild = buttonBack(scene);
  setLeftTop(
    buttonbackChild,
    viewGoldShopData.children.buttonBack.x - viewGoldShopData.width / 2,
    viewGoldShopData.children.buttonBack.y - viewGoldShopData.height / 2,
  );
  view.add(buttonbackChild);

  const viewgoldshopitemrewardChild = buildViewGoldShopItemReward(
    scene,
    viewGoldShopData.children.viewGoldShopItemReward,
  );
  setLeftTop(
    viewgoldshopitemrewardChild,
    viewGoldShopData.children.viewGoldShopItemReward.x - viewGoldShopData.width / 2,
    viewGoldShopData.children.viewGoldShopItemReward.y - viewGoldShopData.height / 2,
  );
  view.add(viewgoldshopitemrewardChild);

  return view;
}
```

Здесь root знает только:

- свой `viewGoldShopData`;
- своих direct children;
- какой direct child является `rootRef`;
- какой direct child собирается private builder.

### Private builder получает локальный data

```ts
function buildViewGoldShopItemReward(
  scene: Phaser.Scene,
  data: typeof viewGoldShopData.children.viewGoldShopItemReward,
): Phaser.GameObjects.Container {
  const view = createContainerFromViewData(scene, data);

  const bgChild = createAssetChild(scene, data.children['bgGoldShopItem.nine.40']);
  setLeftTop(
    bgChild,
    data.children['bgGoldShopItem.nine.40'].x - data.width / 2,
    data.children['bgGoldShopItem.nine.40'].y - data.height / 2,
  );
  view.add(bgChild);

  const buttonChild = buildButtonGoldShopItemReward(
    scene,
    data.children.buttonGoldShopItemReward,
  );
  setLeftTop(
    buttonChild,
    data.children.buttonGoldShopItemReward.x - data.width / 2,
    data.children.buttonGoldShopItemReward.y - data.height / 2,
  );
  view.add(buttonChild);

  return view;
}
```

Ключевой эффект: внутри builder используется короткий `data`, а не полный путь от root.

## Нужно ли типизировать параметр `data`

Есть два варианта.

### Вариант A. Без типизации data

```ts
function buildViewGoldShopItemReward(
  scene: Phaser.Scene,
  data,
): Phaser.GameObjects.Container {
}
```

Плюсы:

- максимально простой output;
- нет риска сломать подсказки на generated data-константах;
- нет сложных `typeof ...` путей.

Минусы:

- внутри builder IDE хуже понимает `data.children`.

### Вариант B. Через `typeof` конкретного поля

```ts
function buildViewGoldShopItemReward(
  scene: Phaser.Scene,
  data: typeof viewGoldShopData.children.viewGoldShopItemReward,
): Phaser.GameObjects.Container {
}
```

Плюсы:

- data-константа все еще не типизирована явно;
- IDE может видеть реальные поля;
- нет `Record` на generated data.

Минусы:

- типовая строка может быть длинной;
- для deep nested builder тип снова может быть длинным.

Рекомендация: начать с варианта A без типизации параметра `data`. Это лучше соответствует KISS. Если потом окажется, что IDE-подсказки внутри generated private builders реально нужны, можно перейти на `typeof`.

## Правило сборки direct child

Для каждого direct child текущего `data` генерируется один маленький блок:

### Asset child

```ts
const bgChild = createAssetChild(scene, data.children['bgGoldShopItem.nine.40']);
setLeftTop(
  bgChild,
  data.children['bgGoldShopItem.nine.40'].x - data.width / 2,
  data.children['bgGoldShopItem.nine.40'].y - data.height / 2,
);
view.add(bgChild);
```

### Text child

```ts
const titleChild = createTextChild(scene, data.children.textGoldShopItemRewardTitle);
setLeftTop(
  titleChild,
  data.children.textGoldShopItemRewardTitle.x - data.width / 2,
  data.children.textGoldShopItemRewardTitle.y - data.height / 2,
);
view.add(titleChild);
```

### Nested view/button child

```ts
const valueChild = buildViewGoldShopItemSmallValue(
  scene,
  data.children.viewGoldShopItemSmallValue,
);
setLeftTop(
  valueChild,
  data.children.viewGoldShopItemSmallValue.x - data.width / 2,
  data.children.viewGoldShopItemSmallValue.y - data.height / 2,
);
view.add(valueChild);
```

### RootRef child

```ts
const backChild = buttonBack(scene);
setLeftTop(
  backChild,
  data.children.buttonBack.x - data.width / 2,
  data.children.buttonBack.y - data.height / 2,
);
view.add(backChild);
```

## Где должны находиться private builders

В том же generated `*.view.ts` файле, после root factory-функций или рядом с тем root, которому они принадлежат.

Рекомендуемый порядок:

1. imports;
2. root data-константа;
3. root factory-функция;
4. private builders для nested view этого root;
5. следующий root data;
6. следующий root factory;
7. private builders следующего root.

Так код удобно читать сверху вниз: сначала публичный root, потом его внутренняя сборка.

## Комментарии в generated code

В generated code нужно оставить короткий комментарий на русском, который объясняет архитектуру.

Пример перед private builder:

```ts
/**
 * Собирает вложенный view только из его direct children.
 * Родительский builder вызывает эту функцию и не разворачивает внутренности сам.
 */
function buildViewGoldShopItemReward(scene: Phaser.Scene, data): Phaser.GameObjects.Container {
}
```

Такой комментарий полезен, потому что объясняет не конкретную строку, а общую модель.

## Изменения в генераторе

Файл:

```text
server/src/export/phaser-source-generator.js
```

Нужно изменить генерацию view-функций.

### Сейчас

Generator рекурсивно пишет весь код сборки внутрь одной root factory.

### Нужно

Разделить генерацию на два шага:

1. `renderRootViewFunction(rootData)` - пишет только root и direct children.
2. `renderPrivateBuilderFunction(viewData)` - пишет builder для nested `view/button` и его direct children.

Pseudo-flow:

```ts
function renderRootView(root) {
  writeRootData(root);
  writeRootFactory(root);

  collectNestedViews(root).forEach((nestedView) => {
    writePrivateBuilder(nestedView);
  });
}
```

Но `collectNestedViews` не должен пытаться уникализировать имена. Он просто собирает nested views и выводит builder names по Figma names.

Если два builder names совпали, TypeScript покажет duplicate function implementation. Это ожидаемое поведение.

## Как получить имя private builder

Простое правило:

```ts
build + pascalCase(figmaNode.name)
```

Примеры:

```text
viewGoldShopItemReward -> buildViewGoldShopItemReward
buttonGoldShopItemReward -> buildButtonGoldShopItemReward
view.StyleShopMoneyCounter -> buildViewStyleShopMoneyCounter
button.ConfirmExit.yes -> buildButtonConfirmExitYes
```

Никаких suffix `2`, `3`, `4`.

## Почему это удобно для ручного тюнинга

Generated файл становится похож на набор маленьких функций:

```ts
export function viewGoldShop(scene) {}
function buildViewGoldShopItemReward(scene, data) {}
function buildButtonGoldShopItemReward(scene, data) {}
function buildViewGoldShopItemSmallValue(scene, data) {}
```

Если нужно вручную тюнить код, можно скопировать generated файл в обычный game-файл и править конкретный builder, а не выковыривать кусок из огромной root function.

Это удобно:

- легче найти нужный view;
- легче заменить один nested builder вручную;
- легче поставить breakpoint;
- легче читать diff после регенерации;
- легче понять, какой уровень layout отвечает за какой Phaser container.

## Риски

- При дублях имен generated TS может не компилироваться. Это нормально: нужно исправить Figma names.
- Файл станет содержать больше функций, но каждая функция будет короче.
- Если nested view очень много, function list будет длинным. Это лучше, чем одна огромная функция.
- Нужно не потерять поведение `rootRef`: оно вызывает root factory, а не private builder.
- Нужно сохранить текущие правила позиционирования `x - parent.width / 2`, `y - parent.height / 2`.

## Проверка после реализации

1. Сгенерировать view-файл.
2. Убедиться, что root factory содержит только direct children root.
3. Убедиться, что nested view имеют private builders.
4. Убедиться, что private builder содержит только direct children своего `data`.
5. Убедиться, что нет auto suffixes для duplicate builder names.
6. Убедиться, что `rootRef` вызывает root function.
7. Проверить визуально несколько экранов в Phaser.
8. Проверить `node -c code.js`.
9. Проверить `node -c server/src/export/phaser-source-generator.js`.

## Итог

Выбранный путь: private builders.

Он решает главную проблему без скрытой магии: родительский view больше не разворачивает всю глубину, но generated code остается явным и удобным для ручного тюнинга.

Генератор не должен исправлять дубли builder names. Если дубли появились, это сигнал оператору исправить Figma-структуру.
