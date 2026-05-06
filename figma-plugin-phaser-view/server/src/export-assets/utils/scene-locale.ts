// scene-locale.ts

/**
 * Ключ локали в Scene Data Manager.
 */
export const SCENE_LOCALE_KEY = 'SCENE_LOCALE_KEY';

/**
 * Устанавливает локаль в данные сцены.
 *
 * При первом создании ключа Phaser отправит `setdata`.
 * При изменении существующего ключа Phaser отправит `changedata-locale`.
 */
export function setSceneLocale(scene: Phaser.Scene, locale: string): void {
    scene.data.set(SCENE_LOCALE_KEY, locale);
}

/**
 * Читает локаль из данных сцены.
 */
export function getSceneLocale(scene: Phaser.Scene): string | undefined {
    return scene.data.get(SCENE_LOCALE_KEY);
}

/**
 * Подписывается на первое создание и последующие изменения локали сцены.
 *
 * Phaser разделяет события:
 * - `Phaser.Data.Events.SET_DATA` — новый ключ создан впервые;
 * - `Phaser.Data.Events.CHANGE_DATA_KEY + "locale"` — изменился конкретный ключ `locale`.
 *
 * Поэтому функция слушает оба события и сводит их к одному callback:
 * `onLocaleChange(locale)`.
 */
export function onSceneLocaleChange(
    scene: Phaser.Scene,
    onLocaleChange: (locale: string) => void
): () => void {
    function handleSetData(...args: [unknown, string, string]): void {
        if (args[1] === SCENE_LOCALE_KEY) {
            onLocaleChange(args[2]);
        }
    }

    function handleChangeLocale(...args: [unknown, string, string]): void {
        onLocaleChange(args[1]);
    }

    scene.events.on(Phaser.Data.Events.SET_DATA, handleSetData);
    scene.events.on(getSceneLocaleChangeEventName(), handleChangeLocale);

    return function offSceneLocaleKey(): void {
        scene.events.off(Phaser.Data.Events.SET_DATA, handleSetData);
        scene.events.off(getSceneLocaleChangeEventName(), handleChangeLocale);
    };
}

/**
 * Возвращает имя события изменения конкретного ключа локали.
 *
 * Для ключа `locale` Phaser-событие будет `changedata-locale`.
 */
function getSceneLocaleChangeEventName(): string {
    return `${Phaser.Data.Events.CHANGE_DATA_KEY}${SCENE_LOCALE_KEY}`;
}
