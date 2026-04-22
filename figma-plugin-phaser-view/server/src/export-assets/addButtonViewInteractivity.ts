const BUTTON_HOVER_SCALE = 1.05;
const BUTTON_HOVER_RESTORE_DELAY_MS = 160;

/**
 * Подключает поведение кнопок по указателю к текущей сцене.
 *
 * Хелпер работает в рамках одной сцены: он ставит слушатели на `scene.input` один раз
 * на сцену, хранит состояние кнопок в scene-owned store и сам чистит внутреннее
 * состояние таймера и слушателей при `SHUTDOWN` сцены.
 *
 * Поведение:
 * - слушает `GAMEOBJECT_POINTER_OVER`, `GAMEOBJECT_POINTER_OUT` и `GAMEOBJECT_POINTER_DOWN`;
 * - реагирует только на интерактивные `Container`, помеченные через `setData("button", true)`;
 * - запоминает исходные `scaleX` / `scaleY` для каждой кнопки и восстанавливает именно их;
 * - применяет hover-масштаб `1.1`;
 * - при нажатии временно возвращает базовый масштаб, эмитит
 *   `scene.events.emit("onClick", { gameObjectName })` и через короткую задержку
 *   возвращает hover, если указатель все еще находится внутри кнопки;
 * - отменяет отложенное восстановление, если указатель ушел, кнопка уничтожена
 *   или сцена закрылась.
 *
 * Ожидания по использованию:
 * - вызывать из жизненного цикла сцены, например из `create()`;
 * - снаружи не делать ручную отписку, потому что cleanup на `SHUTDOWN` уже зарегистрирован внутри;
 * - передавать только сцену, а не отдельные кнопки, потому что хелпер сам находит подходящие
 *   объекты в payload input-событий;
 * - `testButtonViewInteractivity(scene)` использовать только для локальной отладки и логирования.
 *
 * Примечания:
 * - повторные вызовы в одной и той же сцене идемпотентны и не добавляют дубликаты слушателей;
 * - хелпер не считает кнопкой любой интерактивный объект, а только `Container` с `data.button === true`;
 * - отложенное восстановление hover использует `scene.time`, поэтому подчиняется clock сцены
 *   и отменяется при shutdown.
 *
 * @param scene - сцена Phaser, которая владеет input-слушателями и жизненным циклом таймера.
 */
export function addButtonInteractivity(scene: Phaser.Scene) {
  const store = getSceneButtonInteractionStore(scene);

  bindSceneButtonInteractivityShutdown(scene, store);
  bindSceneButtonInteractivity(scene, store);
}

function getSceneButtonInteractionStore(scene: Phaser.Scene): ButtonInteractionStore {
  const store = sceneButtonStores.get(scene);
  if (store != null) return store;

  const nextStore: ButtonInteractionStore = {
    buttons: new Map(),
    isBound: false,
    isShutdownBound: false,
  };

  sceneButtonStores.set(scene, nextStore);
  return nextStore;
}

function bindSceneButtonInteractivityShutdown(scene: Phaser.Scene, store: ButtonInteractionStore) {
  if (store.isShutdownBound) return;
  store.isShutdownBound = true;

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    disposeSceneButtonInteractivity(scene);
  });
}

function bindSceneButtonInteractivity(scene: Phaser.Scene, store: ButtonInteractionStore) {
  if (store.isBound) return;

  const onPointerDown = (
    _pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ) => {
    const button = findButtonGameObject(gameObjects);
    if (button == null) return;
    handleButtonPointerDown(scene, store, button);
  };

  const onPointerOver = (
    _pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ) => {
    const button = findButtonGameObject(gameObjects);
    if (button == null) return;
    handleButtonPointerOver(store, button);
  };

  const onPointerOut = (
    _pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ) => {
    const button = findButtonGameObject(gameObjects);
    if (button == null) return;
    handleButtonPointerOut(store, button);
  };

  store.handlers = {
    onPointerDown,
    onPointerOver,
    onPointerOut,
  };

  scene.input.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onPointerDown);
  scene.input.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, onPointerOver);
  scene.input.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, onPointerOut);

  store.isBound = true;
}

function disposeSceneButtonInteractivity(scene: Phaser.Scene) {
  const store = sceneButtonStores.get(scene);
  if (store == null) return;

  const buttonEntries = Array.from(store.buttons.entries());
  for (const [button, state] of buttonEntries) {
    cancelHoverRestoreTimer(state);
    if (button.scene != null) {
      restoreButtonBaseScale(button, state);
    }
  }

  if (store.handlers != null) {
    scene.input.off(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, store.handlers.onPointerDown);
    scene.input.off(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, store.handlers.onPointerOver);
    scene.input.off(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, store.handlers.onPointerOut);
  }

  store.buttons.clear();
  store.handlers = undefined;
  store.isBound = false;
  store.isShutdownBound = false;
  sceneButtonStores.delete(scene);
}

function findButtonGameObject(gameObjects: Phaser.GameObjects.GameObject[]) {
  return gameObjects.find(isButtonGameObject);
}

function isButtonGameObject(gameObject: Phaser.GameObjects.GameObject): gameObject is ButtonGameObject {
  if (!(gameObject instanceof Phaser.GameObjects.Container)) return false;
  return gameObject.getData("button") === true;
}

function handleButtonPointerDown(
  scene: Phaser.Scene,
  store: ButtonInteractionStore,
  button: ButtonGameObject,
) {
  const state = getOrCreateButtonInteractionState(store, button);
  state.isPointerInside = true;

  cancelHoverRestoreTimer(state);
  restoreButtonBaseScale(button, state);
  scheduleHoverRestore(scene, state, button);
  emitButtonClick(scene, button);
}

function handleButtonPointerOver(
  store: ButtonInteractionStore,
  button: ButtonGameObject,
) {
  const state = getOrCreateButtonInteractionState(store, button);
  state.isPointerInside = true;

  cancelHoverRestoreTimer(state);
  applyButtonHoverScale(button, state);
}

function handleButtonPointerOut(
  store: ButtonInteractionStore,
  button: ButtonGameObject,
) {
  const state = getOrCreateButtonInteractionState(store, button);
  state.isPointerInside = false;

  cancelHoverRestoreTimer(state);
  restoreButtonBaseScale(button, state);
}

function getOrCreateButtonInteractionState(
  store: ButtonInteractionStore,
  button: ButtonGameObject,
): ButtonInteractionState {
  const existingState = store.buttons.get(button);
  if (existingState != null) return existingState;

  const nextState: ButtonInteractionState = {
    baseScale: {
      x: button.scaleX,
      y: button.scaleY,
    },
    isPointerInside: false,
  };

  store.buttons.set(button, nextState);
  button.once(Phaser.GameObjects.Events.DESTROY, () => {
    removeButtonInteractionState(store, button);
  });

  return nextState;
}

function removeButtonInteractionState(store: ButtonInteractionStore, button: ButtonGameObject) {
  const state = store.buttons.get(button);
  if (state == null) return;

  cancelHoverRestoreTimer(state);
  store.buttons.delete(button);
}

function scheduleHoverRestore(
  scene: Phaser.Scene,
  state: ButtonInteractionState,
  button: ButtonGameObject,
) {
  state.restoreTimer = scene.time.delayedCall(BUTTON_HOVER_RESTORE_DELAY_MS, () => {
    state.restoreTimer = undefined;

    if (button.scene == null) return;
    if (!state.isPointerInside) return;

    applyButtonHoverScale(button, state);
  });
}

function cancelHoverRestoreTimer(state: ButtonInteractionState) {
  if (state.restoreTimer == null) return;

  state.restoreTimer.remove(false);
  state.restoreTimer = undefined;
}

function applyButtonHoverScale(button: ButtonGameObject, state: ButtonInteractionState) {
  const nextScaleX = state.baseScale.x * BUTTON_HOVER_SCALE;
  const nextScaleY = state.baseScale.y * BUTTON_HOVER_SCALE;

  button.setScale(nextScaleX, nextScaleY);
}

function restoreButtonBaseScale(button: ButtonGameObject, state: ButtonInteractionState) {
  button.setScale(state.baseScale.x, state.baseScale.y);
}

function emitButtonClick(scene: Phaser.Scene, button: ButtonGameObject) {
  scene.events.emit("onClick", { gameObjectName: button.name });
}

export function testButtonViewInteractivity(scene: Phaser.Scene) {
  const onClick = ({ gameObjectName }: { gameObjectName: string }) => {
    console.log("onClick", gameObjectName);
  };

  scene.events.on("onClick", onClick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off("onClick", onClick));
}

type ButtonGameObject = Phaser.GameObjects.Container;

interface ButtonScale {
  x: number;
  y: number;
}

interface ButtonInteractionState {
  baseScale: ButtonScale;
  isPointerInside: boolean;
  restoreTimer?: Phaser.Time.TimerEvent;
}

interface ButtonInteractionHandlers {
  onPointerDown: (
    pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ) => void;
  onPointerOver: (
    pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ) => void;
  onPointerOut: (
    pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ) => void;
}

interface ButtonInteractionStore {
  buttons: Map<ButtonGameObject, ButtonInteractionState>;
  handlers?: ButtonInteractionHandlers;
  isBound: boolean;
  isShutdownBound: boolean;
}

const sceneButtonStores = new WeakMap<Phaser.Scene, ButtonInteractionStore>();
