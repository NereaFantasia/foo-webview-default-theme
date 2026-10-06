import { Button, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import {
  Dismiss16Regular,
  Square16Regular,
  SquareMultiple16Regular,
  Subtract16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import styles from './CaptionButtons.module.css';
import { windowShellAtom, windowShellKey } from '../host/windowShell.ts';
import { useService } from '../kit/useService.ts';

// 与系统的标题栏键同宽（46，宿主按这个宽度留出三键区），高度随标题栏铺满整条，方角；图标 16 像素，与标题栏
// 里别的键一样大。
const useStyles = makeStyles({
  key: {
    minWidth: '46px',
    width: '46px',
    height: '100%',
    borderRadius: '0',
    color: tokens.colorNeutralForeground3,
  },
  glyph: { width: '16px', height: '16px' },
});

/**
 * 最大化键挂上后量它的矩形交给窗口壳，键的尺寸变了（标题栏换档）或窗口缩放（三键贴着右缘，跟着挪）
 * 时重量；同值由窗口壳挡掉。卸下时只摘监听、不向宿主撤矩形：只有页面重载才会卸下它，宿主那时自己会
 * 忘掉矩形。键包在 Tooltip 里，Tooltip 合并 ref 时丢掉 ref 回调的返回值，所以用对象 ref 加 effect。
 */
function useMaximizeRegion(): RefObject<HTMLButtonElement | null> {
  const windowShell = useService(windowShellKey);
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const box = element.getBoundingClientRect();
      windowShell.setMaximizeButtonRegion({
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
      });
    };
    // 窗口缩放的事件先于跨档的重排到，当场量会先报一个旧高度的矩形；等到下一帧布局落定再量。
    let frame = 0;
    const onResize = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
    };
  }, [windowShell]);
  return ref;
}

/**
 * 标题栏右端的最小化、最大化 / 还原、关闭。宿主不在时全部置灰：那时的调用都答 NOT_SUPPORTED，
 * 键能点却没反应。关闭键悬停也用中性底，不用系统红。
 *
 * 系统在最大化键上给贴靠布局时（Windows 11），它的悬停提示一直不出，免得盖住系统的浮层；名字照样经
 * `aria-label` 给读屏。提示由这里受控，键本身不因此重挂。
 */
export function CaptionButtons() {
  const t = useAtomValueRawSync(translateAtom);
  const { status, maximized, snapLayouts } = useAtomValueRawSync(windowShellAtom);
  const windowShell = useService(windowShellKey);
  const classes = useStyles();
  const maximizeRef = useMaximizeRegion();
  const [maximizeTip, setMaximizeTip] = useState(false);
  const disabled = status !== 'connected';
  const maximizeLabel = maximized ? t('window.restore') : t('window.maximize');
  return (
    <div className={styles.root}>
      <Tooltip content={t('window.minimize')} relationship="label" positioning="below">
        <Button
          appearance="subtle"
          className={classes.key}
          icon={<Subtract16Regular className={classes.glyph} />}
          disabled={disabled}
          onClick={() => void windowShell.minimize()}
        />
      </Tooltip>
      <Tooltip
        content={maximizeLabel}
        relationship="label"
        positioning="below"
        visible={maximizeTip && !snapLayouts}
        onVisibleChange={(_, data) => setMaximizeTip(data.visible)}
      >
        <Button
          ref={maximizeRef}
          appearance="subtle"
          className={classes.key}
          icon={
            maximized ? (
              <SquareMultiple16Regular className={classes.glyph} />
            ) : (
              <Square16Regular className={classes.glyph} />
            )
          }
          disabled={disabled}
          data-caption="maximize"
          onClick={() => void windowShell.toggleMaximize()}
        />
      </Tooltip>
      <Tooltip content={t('window.close')} relationship="label" positioning="below">
        <Button
          appearance="subtle"
          className={classes.key}
          icon={<Dismiss16Regular className={classes.glyph} />}
          disabled={disabled}
          onClick={() => void windowShell.close()}
        />
      </Tooltip>
    </div>
  );
}
