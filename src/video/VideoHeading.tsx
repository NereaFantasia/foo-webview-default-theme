import { Button, Tooltip } from '@fluentui/react-components';
import { FolderOpen20Regular, FolderSearch20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactElement } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import type { WidthTier } from '../kit/useWidthTier.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import styles from './VideoHeading.module.css';

/**
 * 页头条的宽度档：`full` 操作键带文字，`icons` 只剩图标，`stacked` 在图标之外让出导航行那一排，
 * 标题与操作键换到胶囊下面一行；没有导航行时没有第三档
 */
export type HeadingTier = 'full' | 'icons' | 'stacked';
type Tiers = readonly [WidthTier<HeadingTier>, ...WidthTier<HeadingTier>[]];

/** 阈值按两侧胶囊让位后中间还放得下标题与带文字的操作键估的，容器宽度，像素 */
export const NAV_ROW_TIERS: Tiers = [
  { tier: 'full', min: 900 },
  { tier: 'icons', min: 640 },
  { tier: 'stacked', min: 0 },
];
export const PLAIN_TIERS: Tiers = [
  { tier: 'full', min: 520 },
  { tier: 'icons', min: 0 },
];

function Action({
  label,
  icon,
  labelled,
  disabled = false,
  onClick,
}: {
  readonly label: string;
  readonly icon: ReactElement;
  readonly labelled: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  const controls = useViewControlStyles();
  return (
    <Tooltip content={label} relationship="label">
      <Button
        appearance="subtle"
        className={controls.plain}
        icon={icon}
        disabled={disabled}
        onClick={onClick}
      >
        {labelled ? label : undefined}
      </Button>
    </Tooltip>
  );
}

/**
 * 内嵌时停靠在画面上方的页头条：贴卡片上缘，透明地坐在阅读面上，上面两个角就是卡片的圆角
 * 播放栏在标题栏时导航胶囊浮在这一条里，标题与操作键落在两组胶囊之间，让位的宽度由外壳给出
 */
export function VideoHeading({
  title,
  tier,
  canReveal,
  onBrowse,
  onReveal,
}: {
  readonly title: string;
  readonly tier: HeadingTier;
  readonly canReveal: boolean;
  readonly onBrowse: () => void;
  readonly onReveal: () => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const labelled = tier === 'full';
  return (
    <div className={styles.root} data-tier={tier}>
      <span className={styles.title}>{title}</span>
      <div className={styles.actions}>
        <Action
          label={t('video.browse')}
          icon={<FolderSearch20Regular />}
          labelled={labelled}
          onClick={onBrowse}
        />
        <Action
          label={t('video.reveal')}
          icon={<FolderOpen20Regular />}
          labelled={labelled}
          disabled={!canReveal}
          onClick={onReveal}
        />
      </div>
    </div>
  );
}
