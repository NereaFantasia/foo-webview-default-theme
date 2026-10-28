import { Button, Tooltip } from '@fluentui/react-components';
import { FullScreenMaximize20Regular, FullScreenMinimize20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { FocusEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { hostFullscreenAtom, type ImmersiveShell } from './immersiveShell.ts';
import { useControlKeyClasses } from './controlKeyStyles.ts';
import styles from './ImmersiveControls.module.css';
import { ViewKey } from './ViewKey.tsx';

export interface ImmersiveControlsProps {
  readonly shell: Pick<ImmersiveShell, 'toggleFullscreen' | 'leave'> | null;
  /** 控件层此刻该不该显示；藏起时淡出且不接指针 */
  readonly shown: boolean;
  /** 焦点进出控件层时叫，参数是焦点此刻在不在层里 */
  readonly onFocusWithin: (inside: boolean) => void;
  /** 场景里的元素挂进控制层的两个点：顶部居中放页签，左边视图键之后放预设场景自己的键；图纸场景不用，不给也行 */
  readonly slotRefs?: {
    readonly tabs: (element: HTMLElement | null) => void;
    readonly views: (element: HTMLElement | null) => void;
  };
}

/**
 * 控件层：左边是视图键（切换图纸与歌词两种视图）与预设场景自己的键的挂载点，顶部居中是页签的挂载点，
 * 右边是全屏键与 Esc 胶囊。键都是 44 的 Acrylic 圆键，离顶 20（窗高不到 466 时 12）、离左右 32，上下居中线与页签行同线。全屏键切宿主主窗的全屏，
 * 宿主不在或这扇窗不支持全屏时不出；胶囊上只写 Esc，按它与按 Esc 一样是离开这一页。整层自己不接指针，只有键接，
 * 免得挡住场景里的件
 */
export function ImmersiveControls({
  shell,
  shown,
  onFocusWithin,
  slotRefs,
}: ImmersiveControlsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const fullscreen = useAtomValueRawSync(hostFullscreenAtom);
  const keys = useControlKeyClasses();
  const fullscreenLabel = fullscreen ? t('immersive.exitFullscreen') : t('immersive.fullscreen');
  // 只有键盘带来的焦点算：鼠标点过的键会一直留着焦点，算上的话控件层与光标就再也不藏了
  // 焦点在层里的两颗键之间移动时不算离开
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target.matches(':focus-visible')) onFocusWithin(true);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node && event.currentTarget.contains(next))) onFocusWithin(false);
  };
  return (
    <div
      className={styles.controls}
      data-hidden={!shown || undefined}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className={styles.leading}>
        <ViewKey />
        <div ref={slotRefs?.views} className={styles.viewsSlot} />
      </div>
      <div ref={slotRefs?.tabs} className={styles.tabsSlot} />
      <div className={styles.corner}>
        {fullscreen !== null && (
          <Tooltip content={fullscreenLabel} relationship="label">
            <Button
              appearance="transparent"
              shape="circular"
              className={keys.key}
              icon={fullscreen ? <FullScreenMinimize20Regular /> : <FullScreenMaximize20Regular />}
              aria-label={fullscreenLabel}
              data-fullscreen={fullscreen ? 'on' : 'off'}
              onClick={() => void shell?.toggleFullscreen()}
            />
          </Tooltip>
        )}
        <Tooltip content={t('immersive.exit')} relationship="label">
          <Button
            appearance="transparent"
            shape="circular"
            className={keys.esc}
            aria-label={t('immersive.exit')}
            onClick={() => shell?.leave()}
          >
            <kbd className={styles.key}>Esc</kbd>
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
