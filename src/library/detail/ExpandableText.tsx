import {
  Button,
  Popover,
  PopoverTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import { ChevronDown16Regular, ChevronUp16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { PopoverSurface } from '../../theme/PopoverSurface.tsx';
import styles from './ExpandableText.module.css';

const useStyles = makeStyles({
  arrow: {
    width: '32px',
    minWidth: '32px',
    height: '32px',
    flexShrink: 0,
    color: 'var(--text-secondary)',
  },
  open: {
    '@media (forced-colors: none)': {
      '&:not(:disabled, [aria-disabled="true"])': { backgroundColor: 'var(--bg-chip)' },
    },
    color: 'var(--text-primary)',
  },
});

/**
 * 详情页头可折叠多行简介
 * 常驻状态折叠多余空白并截断展示，溢出时显示展开按钮，并在弹出气泡中保留原始段落完整展示
 */
export function ExpandableText({ text }: { readonly text: string }) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const clamp = useRef<HTMLParagraphElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const element = clamp.current;
    if (!element) return;
    const measure = () => setOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className={styles.row} data-detail-description>
      <p ref={clamp} className={styles.text}>
        {text.replace(/\s+/g, ' ')}
      </p>
      {overflow && (
        <Popover
          open={open}
          positioning={{ position: 'below', align: 'end' }}
          onOpenChange={(_, data) => setOpen(data.open)}
        >
          <Tooltip content={t('detail.descriptionMore')} relationship="label">
            <PopoverTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
                shape="circular"
                className={mergeClasses(controls.icon, classes.arrow, open && classes.open)}
                icon={open ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
                aria-label={t('detail.descriptionMore')}
                data-detail-description-more
              />
            </PopoverTrigger>
          </Tooltip>
          <PopoverSurface className={styles.surface} data-detail-description-full>
            {text}
          </PopoverSurface>
        </Popover>
      )}
    </div>
  );
}
