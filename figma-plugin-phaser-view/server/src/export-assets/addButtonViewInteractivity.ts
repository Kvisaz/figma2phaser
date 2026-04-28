const BUTTON_HOVER_SCALE = 1.05;
const BUTTON_HOVER_RESTORE_DELAY_MS = 160;
const BUTTON_BASE_SCALE_DATA_KEY = "button.interactivity.BaseScale";
const BUTTON_POINTER_INSIDE_DATA_KEY = "button.interactivity.PointerInside";
const BUTTON_RESTORE_TIMER_DATA_KEY = "button.interactivity.RestoreTimer";

type Pointer = Phaser.Input.Pointer;
type Scene = Phaser.Scene;
type GameObject = Phaser.GameObjects.GameObject;

/**
 * Подключает поведение кнопок по указателю к текущей сцене.
 *
 * Хелпер слушает input сцены, выбирает только `Container` с `data.button === true`,
 * а состояние конкретной кнопки хранит на самой кнопке через `setData/getData`.
 */
export function addButtonInteractivity(scene: Scene) {
  const onPointerDown = (
      _pointer: Pointer,
      gameObject: GameObject,
  ) => {
    if (!isButtonGameObject(gameObject)) return;
    handleButtonPointerDown(scene, gameObject);
  };

  const onPointerOver = (
      _pointer: Pointer,
      gameObject: GameObject,
  ) => {
    if (!isButtonGameObject(gameObject)) return;
    handleButtonPointerOver(gameObject);
  };

  const onPointerOut = (
      _pointer: Pointer,
      gameObject: GameObject,
  ) => {
    if (!isButtonGameObject(gameObject)) return;
    handleButtonPointerOut(gameObject);
  };

  scene.input.on(Phaser.Input.Events.GAMEOBJECT_DOWN, onPointerDown);
  scene.input.on(Phaser.Input.Events.GAMEOBJECT_OVER, onPointerOver);
  scene.input.on(Phaser.Input.Events.GAMEOBJECT_OUT, onPointerOut);

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.input.off(Phaser.Input.Events.GAMEOBJECT_DOWN, onPointerDown);
    scene.input.off(Phaser.Input.Events.GAMEOBJECT_OVER, onPointerOver);
    scene.input.off(Phaser.Input.Events.GAMEOBJECT_OUT, onPointerOut);
  });
}

export function markGameObjectAsButton<T extends GameObject>(gameObject: T): T {
  return gameObject.setData("button", true);
}


function isButtonGameObject(gameObject: GameObject): gameObject is ButtonGameObject {
  return gameObject.getData("button") === true;
}

function handleButtonPointerDown(scene: Scene, button: ButtonGameObject) {
  ensureButtonBaseScale(button);
  button.setData(BUTTON_POINTER_INSIDE_DATA_KEY, true);

  cancelHoverRestoreTimer(button);
  restoreButtonBaseScale(button);
  scheduleHoverRestore(scene, button);
  emitButtonClick(scene, button);
}

function handleButtonPointerOver(button: ButtonGameObject) {
  ensureButtonBaseScale(button);
  button.setData(BUTTON_POINTER_INSIDE_DATA_KEY, true);

  cancelHoverRestoreTimer(button);
  applyButtonHoverScale(button);
}

function handleButtonPointerOut(button: ButtonGameObject) {
  ensureButtonBaseScale(button);
  button.setData(BUTTON_POINTER_INSIDE_DATA_KEY, false);

  cancelHoverRestoreTimer(button);
  restoreButtonBaseScale(button);
}

function ensureButtonBaseScale(button: ButtonGameObject): ButtonScale {
  const baseScale = button.getData(BUTTON_BASE_SCALE_DATA_KEY) as ButtonScale | undefined;
  if (baseScale != null) return baseScale;

  const nextBaseScale: ButtonScale = {
    x: button.scaleX,
    y: button.scaleY,
  };

  button.setData(BUTTON_BASE_SCALE_DATA_KEY, nextBaseScale);
  return nextBaseScale;
}

function scheduleHoverRestore(scene: Scene, button: ButtonGameObject) {
  const restoreTimer = scene.time.delayedCall(BUTTON_HOVER_RESTORE_DELAY_MS, () => {
    button.setData(BUTTON_RESTORE_TIMER_DATA_KEY, undefined);

    if (button.scene == null) return;
    if (button.getData(BUTTON_POINTER_INSIDE_DATA_KEY) !== true) return;

    applyButtonHoverScale(button);
  });

  button.setData(BUTTON_RESTORE_TIMER_DATA_KEY, restoreTimer);
}

function cancelHoverRestoreTimer(button: ButtonGameObject) {
  const restoreTimer = button.getData(BUTTON_RESTORE_TIMER_DATA_KEY) as Phaser.Time.TimerEvent | undefined;
  if (restoreTimer == null) return;

  restoreTimer.remove(false);
  button.setData(BUTTON_RESTORE_TIMER_DATA_KEY, undefined);
}

function applyButtonHoverScale(button: ButtonGameObject) {
  const baseScale = ensureButtonBaseScale(button);
  const nextScaleX = baseScale.x * BUTTON_HOVER_SCALE;
  const nextScaleY = baseScale.y * BUTTON_HOVER_SCALE;

  button.setScale(nextScaleX, nextScaleY);
}

function restoreButtonBaseScale(button: ButtonGameObject) {
  const baseScale = ensureButtonBaseScale(button);
  button.setScale(baseScale.x, baseScale.y);
}

function emitButtonClick(scene: Scene, button: ButtonGameObject) {
  scene.events.emit("onClick", { gameObjectName: button.name });
}

export function testButtonViewInteractivity(scene: Scene) {
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
