import { FLYOUT_MOTION, FlyoutMotion } from './Surfaces.tsx';

/** 自己画的浮层直接包这一层；与 `motion/Surfaces.tsx` 里包装件的浮层动效是同一个。 */
export const MenuMotion = FlyoutMotion;

/** 传给 Fluent `Menu`、`Popover` 的 `surfaceMotion`，与包装件的缺省动效是同一个。 */
export const MENU_SURFACE_MOTION = FLYOUT_MOTION;
