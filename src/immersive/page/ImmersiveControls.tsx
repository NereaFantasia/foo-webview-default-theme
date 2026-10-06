import { Button, Tooltip } from '@fluentui/react-components';
import { FullScreenMaximize20Regular, FullScreenMinimize20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { FocusEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { hostFullscreenAtom, type ImmersiveShell } from './immersiveShell.ts';
import styles from './ImmersiveControls.module.css';

export interface ImmersiveControlsProps {
  readonly shell: Pick<ImmersiveShell, 'toggleFullscreen' | 'leave'> | null;
  /** 控件层此刻该不该显示；藏起时淡出且不接指针。 */
  readonly shown: boolean;
  /** 焦点进出控件层时叫，参数是焦点此刻在不在层里。 */
  readonly onFocusWithin: (inside: boolean) => void;
}

/**
 * 控件层：右上角的全屏键与 Esc 胶囊。全屏键切宿主主窗的全屏，宿主不在或这扇窗不支持全屏时不出；
 * 胶囊上只写 Esc，按它与按 Esc 一样是离开这一页。整层自己不接指针，只有键接，免得挡住场景里的件。
 */
export function ImmersiveControls({ shell, shown, onFocusWithin }: ImmersiveControlsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const fullscreen = useAtomValueRawSync(hostFullscreenAtom);
  const fullscreenLabel = fullscreen ? t('immersive.exitFullscreen') : t('immersive.fullscreen');
  // 只有键盘带来的焦点算：鼠标点过的键会一直留着焦点，算上的话控件层与光标就再也不藏了。
  // 焦点在层里的两颗键之间移动时不算离开。
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
      <div className={styles.corner}>
        {fullscreen !== null && (
          <Tooltip content={fullscreenLabel} relationship="label">
            <Button
              appearance="outline"
              size="small"
              shape="circular"
              icon={fullscreen ? <FullScreenMinimize20Regular /> : <FullScreenMaximize20Regular />}
              aria-label={fullscreenLabel}
              data-fullscreen={fullscreen ? 'on' : 'off'}
              onClick={() => void shell?.toggleFullscreen()}
            />
          </Tooltip>
        )}
        <Tooltip content={t('immersive.exit')} relationship="label">
          <Button
            appearance="outline"
            size="small"
            shape="circular"
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
