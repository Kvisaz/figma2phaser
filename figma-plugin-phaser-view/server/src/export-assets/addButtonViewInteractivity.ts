export function addButtonInteractivity(scene: Phaser.Scene) {
  const { input } = scene;

  const PREV_DATA_SCALE_KEY = "hoverEffect.realScale";

  const addHoverEffect = (obj: Phaser.GameObjects.Container | Phaser.GameObjects.Image) => {
    const prevScales = (obj.getData(PREV_DATA_SCALE_KEY) as number[] | undefined) ?? [];
    const currentScale = obj.scale;
    const nextScales = [...prevScales, currentScale];
    obj.setData(PREV_DATA_SCALE_KEY, nextScales);
    obj.setScale(1.1);
  };

  const removeHoverEffect = (obj: Phaser.GameObjects.Container | Phaser.GameObjects.Image) => {
    const prevScales = (obj.getData(PREV_DATA_SCALE_KEY) as number[] | undefined) ?? [];
    const lastPrevScale = prevScales.pop();
    if (lastPrevScale == null) return;
    obj.setData(PREV_DATA_SCALE_KEY, prevScales);
    obj.setScale(lastPrevScale);
  };

  const onGamePointerDown = (
    pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ) => {
    const gameObject = gameObjects[0] as undefined | Phaser.GameObjects.Container;
    if (gameObject == null) return;

    removeHoverEffect(gameObject);
    scene.events.emit(`onClick`, { gameObjectName: gameObject.name });
  };

  const onGamePointerOver = (
    pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ) => {
    const gameObject = gameObjects[0] as undefined | Phaser.GameObjects.Container;
    if (gameObject == null) return;
    console.log("gameObject name", gameObject.name);
    addHoverEffect(gameObject);
  };

  const onGamePointerOut = (
    pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ) => {
    const gameObject = gameObjects[0] as undefined | Phaser.GameObjects.Container;
    if (gameObject == null) return;
    console.log("gameObject name", gameObject.name);
    removeHoverEffect(gameObject);
  };

  input.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onGamePointerDown);
  input.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, onGamePointerOver);
  input.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, onGamePointerOut);
}

export function testButtonViewInteractivity(scene: Phaser.Scene) {
  scene.events.on(`onClick`, ({ gameObjectName }: { gameObjectName: string }) => {
    console.log("onClick", gameObjectName);
  });
}
