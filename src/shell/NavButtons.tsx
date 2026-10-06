import { Button, Tooltip, makeStyles } from '@fluentui/react-components';
import { ChevronLeft16Regular, ChevronRight16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { roleVar } from '../theme/roles.ts';
import { historyAtom, historyKey } from '../nav/navHistory.ts';
import { usePlaceName } from './usePlaceName.ts';
import { useService } from '../kit/useService.ts';

export interface NavButtonsProps {
  className?: string;
  /** 圆形悬停底（导航行的胶囊里）；为假时是标题栏工具键的圆角方形。缺省为真。 */
  round?: boolean;
  /** 两键之间画一道 1 × 16 的竖线（导航行的胶囊里）。 */
  divided?: boolean;
}

const useStyles = makeStyles({
  divider: { flex: 'none', width: '1px', height: '16px', backgroundColor: roleVar('line') },
});

/**
 * 后退、前进键（在导航行或标题栏里），与鼠标侧键、Alt+← / → 走同一条全局历史。页面里不另放返回键；
 * 悬停提示写要去的那一处的名字，已跳过主体不在的记录。
 */
export function NavButtons({ className, round = true, divided = false }: NavButtonsProps) {
  const classes = useStyles();
  const t = useAtomValueRawSync(translateAtom);
  const { previous, next } = useAtomValueRawSync(historyAtom);
  const placeName = usePlaceName();
  const history = useService(historyKey);
  const backLabel = previous ? t('nav.backTo', { name: placeName(previous) }) : t('nav.back');
  const forwardLabel = next ? t('nav.forwardTo', { name: placeName(next) }) : t('nav.forward');
  return (
    <>
      <Tooltip content={backLabel} relationship="label">
        <Button
          appearance="subtle"
          shape={round ? 'circular' : 'rounded'}
          className={className}
          icon={<ChevronLeft16Regular />}
          disabled={!previous}
          data-nav="back"
          onClick={() => void history.back()}
        />
      </Tooltip>
      {divided && <span className={classes.divider} aria-hidden />}
      <Tooltip content={forwardLabel} relationship="label">
        <Button
          appearance="subtle"
          shape={round ? 'circular' : 'rounded'}
          className={className}
          icon={<ChevronRight16Regular />}
          disabled={!next}
          data-nav="forward"
          onClick={() => void history.forward()}
        />
      </Tooltip>
    </>
  );
}
