import {
  MenuDivider,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
  type MenuProps,
  type PositioningVirtualElement,
} from '@fluentui/react-components';
import { Menu } from '../../motion/Surfaces.tsx';
import { useAtomValueRawSync } from 'jotai/react';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { WaveformBandsStatus } from '../analysis/trackAnalysis.ts';
import { controlsVisibleAtom } from '../page/immersiveShell.ts';
import { WAVEFORM_MODES, isWaveformMode, needsBands, type WaveformMode } from './waveformModes.ts';
import styles from './PaperWaveformMode.module.css';

const MODE_LABELS: Record<WaveformMode, MessageKey> = {
  rms: 'immersive.waveformRms',
  weighted: 'immersive.waveformWeighted',
  midHigh: 'immersive.waveformMidHigh',
  layers: 'immersive.waveformLayers',
  lanes: 'immersive.waveformLanes',
};

/** 按钮上的字与图纸其他轴说明一样写英文技术名，不走语言包。 */
const CAPTIONS: Record<WaveformMode, string> = {
  rms: 'rms · full band',
  weighted: 'rms · a-weighted',
  midHigh: 'mid + high · full band shade',
  layers: 'low · mid · high',
  lanes: 'lanes · high / mid / low',
};

/** 五个单选项同属的一组，`checkedValues` 按它记选中的那一项。 */
const GROUP = 'waveformMode';

export interface WaveformModeMenu {
  /** 在视口坐标 `point`（CSS 像素）处打开菜单：波形上右键时用。 */
  openAt(point: { readonly x: number; readonly y: number }): void;
}

export interface PaperWaveformModeProps {
  readonly mode: WaveformMode;
  readonly bandsStatus: WaveformBandsStatus;
  /** 指针在波形上。 */
  readonly hovered: boolean;
  onSelect(mode: WaveformMode): void;
  readonly ref?: Ref<WaveformModeMenu>;
}

/** 视口里的一个点，当作菜单的定位目标。 */
function pointTarget(x: number, y: number): PositioningVirtualElement {
  return {
    getBoundingClientRect: () => ({
      x,
      y,
      left: x,
      top: y,
      right: x,
      bottom: y,
      width: 0,
      height: 0,
    }),
  };
}

/**
 * 整轨波形的画法开关：波形带右下角一枚小按钮写着当前画法，点开与在波形上右键（`openAt`）是同一个菜单，
 * 右键打开时菜单定在指针处，从按钮打开时定在按钮下方。按钮兼作图例，叠画的三种颜色画在按钮里；分频结果还没有
 * 或这首取不到时实际画的是全频，按钮照实写。页面拿不到 PCM（`unavailable`）时分频的几种都画不了，整枚按钮不出。
 *
 * 按钮随控件层显隐（静止 3 s 后淡出），指针在波形上、键盘焦点在按钮上、菜单开着时一直显示。
 * 按钮与菜单在 React 树里挂在波形带下面，菜单虽经 Portal 挂到别处，事件照样沿 React 树冒到带上：按下与右键都在
 * 这一层截住，否则按下会被当成拖动 seek 的起点、右键会再开一次菜单。菜单里的 Esc 由菜单自己接住、拦下缺省，
 * 只关菜单，不离开这一页。
 */
export function PaperWaveformMode({
  mode,
  bandsStatus,
  hovered,
  onSelect,
  ref,
}: PaperWaveformModeProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controlsVisible = useAtomValueRawSync(controlsVisibleAtom);
  const [open, setOpen] = useState(false);
  // 右键打开时的定位点；从按钮打开时为 null，菜单按缺省定在按钮下方。
  const [anchor, setAnchor] = useState<PositioningVirtualElement | null>(null);
  const [keyFocused, setKeyFocused] = useState(false);
  const popover = useRef<HTMLDivElement>(null);
  // 右键打开前拿着焦点的元素。菜单关上时焦点还在菜单里或落到了 body，就还给它：不还的话菜单会把焦点交给按钮，
  // 之后按空格按的是这枚按钮而不是播放键。从按钮打开时为 null，焦点照常回到按钮。
  const returnFocus = useRef<HTMLElement | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      openAt({ x, y }) {
        const active = document.activeElement;
        returnFocus.current = active instanceof HTMLElement ? active : null;
        setAnchor(pointTarget(x, y));
        setOpen(true);
      },
    }),
    [],
  );
  if (bandsStatus === 'unavailable') return null;

  const handBack = (): void => {
    const target = returnFocus.current;
    returnFocus.current = null;
    const active = document.activeElement;
    const stranded =
      active === null || active === document.body || (popover.current?.contains(active) ?? false);
    if (target?.isConnected && stranded) target.focus();
  };
  const onOpenChange: MenuProps['onOpenChange'] = (_, data) => {
    if (!data.open) handBack();
    setOpen(data.open);
  };

  const drawn = needsBands(mode) && bandsStatus !== 'ready' ? 'rms' : mode;
  const suffix = !needsBands(mode)
    ? ''
    : bandsStatus === 'loading'
      ? ' · analysing'
      : bandsStatus === 'failed'
        ? ' · bands n/a'
        : '';
  const label = `${t('immersive.waveformMode')}: ${t(MODE_LABELS[mode])}`;
  // 只有键盘带来的焦点算：鼠标点过、菜单关上后焦点会留在按钮上，算上的话它就再也不藏了。
  const shown = controlsVisible || keyFocused || hovered || open;
  const pick: MenuProps['onCheckedValueChange'] = (_, { checkedItems }) => {
    const next = checkedItems[0];
    if (isWaveformMode(next) && next !== mode) onSelect(next);
  };

  return (
    <div
      className={styles.mode}
      data-hidden={!shown || undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Menu
        open={open}
        onOpenChange={onOpenChange}
        positioning={anchor ? { target: anchor } : undefined}
        checkedValues={{ [GROUP]: [mode] }}
        onCheckedValueChange={pick}
      >
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={label} relationship="label">
            <button
              type="button"
              className={styles.chip}
              data-waveform-mode-chip
              onClick={() => {
                returnFocus.current = null;
                setAnchor(null);
              }}
              onFocus={(event) => setKeyFocused(event.currentTarget.matches(':focus-visible'))}
              onBlur={() => setKeyFocused(false)}
              onKeyDown={(event) => {
                // ↓ 由菜单拿去打开自己：定在按钮下方，也不再往上交给视图的音量键。
                if (event.key !== 'ArrowDown') return;
                returnFocus.current = null;
                setAnchor(null);
                event.stopPropagation();
              }}
            >
              {drawn === 'layers' ? (
                <>
                  <span className={`${styles.swatch} ${styles.shade}`} />
                  low <span className={styles.swatch} />
                  mid <span className={`${styles.swatch} ${styles.hot}`} />
                  high
                </>
              ) : (
                CAPTIONS[drawn]
              )}
              {suffix && <span>{suffix}</span>}
              <span className={styles.chevron} aria-hidden>
                ▾
              </span>
            </button>
          </Tooltip>
        </MenuTrigger>
        <MenuPopover ref={popover}>
          <MenuList aria-label={t('immersive.waveformMode')} data-waveform-mode-menu>
            {WAVEFORM_MODES.map((item) => (
              <MenuItemRadio key={item} name={GROUP} value={item} data-waveform-mode={item}>
                {t(MODE_LABELS[item])}
              </MenuItemRadio>
            ))}
            {bandsStatus === 'failed' && (
              <>
                <MenuDivider />
                <MenuItem disabled data-waveform-bands-note>
                  {t('immersive.waveformBandsFailed')}
                </MenuItem>
              </>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}
