import type { fb } from 'foo-webview-sdk/bridge';
import { recordOf, storedRecord } from '../kit/localPref.ts';
import { hostCommand, settle } from './hostCall.ts';
import type { MiniWindowStorage } from './miniWindowSnapshot.ts';

/** 屏幕上的一块矩形，左上右下四条边。 */
export interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * 窗口与它所在屏幕的工作区（去掉任务栏），取浏览器的屏幕坐标，CSS 像素。宿主在窗口移动时通知 WebView，
 * 这两样跟着窗口走；窗口跨到别的屏幕，工作区换成那块屏幕的。
 */
export interface ScreenView {
  readonly window: Edges;
  readonly work: Edges;
}

/** 窗口贴着的那一角：形态切换、菜单开合时这一角不动，窗口朝另外两边伸缩。 */
export interface Corner {
  readonly vertical: 'top' | 'bottom';
  readonly horizontal: 'left' | 'right';
}

/** 宿主窗口的位置与尺寸，屏幕坐标，物理像素。 */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function numberOf(source: object, key: string): number | null {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 从浏览器读窗口与工作区；`availLeft`、`availTop` 不在标准里，读不到时答 null。 */
export function readScreen(): ScreenView | null {
  const { screen, screenX, screenY, outerWidth, outerHeight } = globalThis;
  if (!screen) return null;
  const left = numberOf(screen, 'availLeft');
  const top = numberOf(screen, 'availTop');
  if (left === null || top === null || screen.availWidth <= 0 || screen.availHeight <= 0)
    return null;
  return {
    window: {
      left: screenX,
      top: screenY,
      right: screenX + outerWidth,
      bottom: screenY + outerHeight,
    },
    work: { left, top, right: left + screen.availWidth, bottom: top + screen.availHeight },
  };
}

/** 离工作区哪条边更近就贴哪条：靠下的往上长，靠右的往左长。 */
export function cornerOf(view: ScreenView): Corner {
  const { window, work } = view;
  return {
    vertical: work.bottom - window.bottom < window.top - work.top ? 'bottom' : 'top',
    horizontal: work.right - window.right < window.left - work.left ? 'right' : 'left',
  };
}

/** 把 [start, start + size) 推进 [min, max) 里要挪多少；放不下时贴住 min。 */
function inside(start: number, size: number, min: number, max: number): number {
  if (size >= max - min || start < min) return min - start;
  return start + size > max ? max - (start + size) : 0;
}

/**
 * 窗口从 `current` 换成 `width` × `height` 时的新左上角，物理像素：`corner` 那一角不动，再推回工作区里。
 * `ratio` 是物理像素与浏览器屏幕坐标之比；只用来换算挪动的距离，不换算绝对坐标。
 */
export function placeBox(
  current: Box,
  width: number,
  height: number,
  corner: Corner,
  view: ScreenView,
  ratio: number,
): { readonly x: number; readonly y: number } {
  const x = corner.horizontal === 'right' ? current.x + current.width - width : current.x;
  const y = corner.vertical === 'bottom' ? current.y + current.height - height : current.y;
  const left = view.window.left + (x - current.x) / ratio;
  const top = view.window.top + (y - current.y) / ratio;
  const dx = inside(left, width / ratio, view.work.left, view.work.right);
  const dy = inside(top, height / ratio, view.work.top, view.work.bottom);
  return { x: x + Math.round(dx * ratio), y: y + Math.round(dy * ratio) };
}

/** 窗口与工作区一点都不重叠：记住的位置所在的屏幕已经不在了。 */
export function offScreen(view: ScreenView): boolean {
  const { window, work } = view;
  return (
    window.right <= work.left ||
    window.left >= work.right ||
    window.bottom <= work.top ||
    window.top >= work.bottom
  );
}

export const MINI_POSITION_STORAGE_KEY = 'default-theme.mini-position.v1';

/** 迷你窗口上次停在哪：贴着的那一角，以及这一角的屏幕坐标，物理像素。下次进入时按这一角放回。 */
export interface MiniPosition {
  readonly corner: Corner;
  readonly x: number;
  readonly y: number;
}

export function readMiniPosition(storage: Pick<MiniWindowStorage, 'getItem'>): MiniPosition | null {
  const value = storedRecord(storage.getItem(MINI_POSITION_STORAGE_KEY));
  const { x, y } = value;
  const { vertical, horizontal } = recordOf(value['corner']);
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.abs(x) > 100_000 ||
    Math.abs(y) > 100_000 ||
    (vertical !== 'top' && vertical !== 'bottom') ||
    (horizontal !== 'left' && horizontal !== 'right')
  )
    return null;
  return { corner: { vertical, horizontal }, x, y };
}

/** 浏览器一侧的窗口环境：像素比、窗口在屏幕上的位置，以及等挪动生效的办法。 */
export interface MiniWindowEnv {
  /** 物理像素与 CSS 像素之比。 */
  readonly pixelRatio: () => number;
  /** 窗口与它所在屏幕的工作区；读不到时为 null，窗口只改尺寸、左上角不动。 */
  readonly screen: () => ScreenView | null;
  /** 宿主挪过窗口后，等浏览器拿到新位置。 */
  readonly settleMove: () => Promise<void>;
}

/** 宿主挪窗口后，浏览器经进程间消息才拿到新位置；等这么久再读，毫秒。 */
const MOVE_SETTLE_MS = 100;

export const BROWSER_ENV: MiniWindowEnv = {
  pixelRatio: () => globalThis.devicePixelRatio || 1,
  screen: readScreen,
  settleMove: () => new Promise((resolve) => setTimeout(resolve, MOVE_SETTLE_MS)),
};

export interface MiniPlacementFace {
  readonly ui: Pick<typeof fb.ui, 'getBounds' | 'setBounds' | 'center'>;
}

/** 迷你窗口放在哪：换尺寸时贴哪一角、进入时放回上次的位置、离开或拖完时记下位置。 */
export interface MiniPlacement {
  /** 换成 `width` × `height`（物理像素）时的左上角：贴着离屏幕边近的那一角，再推回工作区。读不到位置时答 null。 */
  anchored(
    width: number,
    height: number,
  ): Promise<{ readonly x: number; readonly y: number } | null>;
  /** 上次记下的那一角换成这个尺寸的左上角；没记过时答 null。 */
  recalled(width: number, height: number): { readonly x: number; readonly y: number } | null;
  /** 放回记住的位置之后调用：越出工作区一部分就推回来，整个不在任何屏幕上就交给宿主居中。 */
  keepOnScreen(): Promise<void>;
  /** 记下窗口贴着的那一角在哪；`moved` 为真时先等浏览器拿到刚挪过的位置。 */
  remember(moved: boolean): Promise<void>;
}

export function createMiniPlacement(
  host: MiniPlacementFace,
  storage: Pick<MiniWindowStorage, 'getItem' | 'setItem'>,
  env: MiniWindowEnv,
): MiniPlacement {
  return {
    async anchored(width, height) {
      const view = env.screen();
      const current = await settle(() => host.ui.getBounds());
      if (!view || !current?.success) return null;
      return placeBox(current, width, height, cornerOf(view), view, env.pixelRatio());
    },
    recalled(width, height) {
      const saved = readMiniPosition(storage);
      if (!saved) return null;
      return {
        x: saved.corner.horizontal === 'right' ? saved.x - width : saved.x,
        y: saved.corner.vertical === 'bottom' ? saved.y - height : saved.y,
      };
    },
    async keepOnScreen() {
      await env.settleMove();
      const view = env.screen();
      if (!view) return;
      if (offScreen(view)) {
        await hostCommand(() => host.ui.center());
        return;
      }
      const current = await settle(() => host.ui.getBounds());
      if (!current?.success) return;
      const corner = { vertical: 'top', horizontal: 'left' } as const;
      const fitted = placeBox(
        current,
        current.width,
        current.height,
        corner,
        view,
        env.pixelRatio(),
      );
      if (fitted.x !== current.x || fitted.y !== current.y)
        await hostCommand(() => host.ui.setBounds(fitted));
    },
    async remember(moved) {
      if (moved) await env.settleMove();
      const view = env.screen();
      const bounds = await settle(() => host.ui.getBounds());
      if (!view || !bounds?.success) return;
      const corner = cornerOf(view);
      // 位置丢了只是下次从原地出现，不影响恢复完整窗口，所以不等落盘。
      storage.setItem(
        MINI_POSITION_STORAGE_KEY,
        JSON.stringify({
          corner,
          x: corner.horizontal === 'right' ? bounds.x + bounds.width : bounds.x,
          y: corner.vertical === 'bottom' ? bounds.y + bounds.height : bounds.y,
        }),
      );
    },
  };
}
