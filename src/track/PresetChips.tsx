import {
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { Checkmark16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { PRESET_LABELS } from './queryLabels.ts';
import { PLAYCOUNT_GROUP, QUERY_PRESETS, type PresetId } from './queryPresets.ts';

const useStyles = makeStyles({
  root: { display: 'grid', rowGap: tokens.spacingVerticalXS, minWidth: 0 },
  title: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXS,
  },
  chip: {
    minWidth: 'auto',
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
});

export interface PresetChipsProps {
  readonly checked: ReadonlySet<PresetId>;
  /** 装没装 foo_playcount；没装时播放与加入时间那几项置灰，null 是还没探出来，先当装了 */
  readonly playcount: boolean | null;
  onToggle(id: PresetId): void;
}

export interface ToggleChip {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  /** 置灰时的说明：置灰的芯片仍可聚焦，说明挂在气泡上 */
  readonly unavailable?: string;
}

/** 筛选浮层里的一组可勾芯片：标题在上，勾上的带对勾；本地的查询预设与在线结果的常用共用 */
export function ToggleChipGroup({
  title,
  chips,
  onToggle,
}: {
  readonly title: string;
  readonly chips: readonly ToggleChip[];
  onToggle(id: string): void;
}) {
  const classes = useStyles();
  const controls = useViewControlStyles();
  const titleId = useId();
  return (
    <div className={classes.root} data-preset-chips>
      <span id={titleId} className={classes.title}>
        {title}
      </span>
      <div role="group" aria-labelledby={titleId} className={classes.chips}>
        {chips.map((one) => {
          const chip = (
            <ToggleButton
              key={one.id}
              size="small"
              appearance="subtle"
              className={mergeClasses(controls.icon, classes.chip)}
              checked={one.checked}
              disabledFocusable={one.unavailable !== undefined}
              icon={one.checked ? <Checkmark16Regular /> : undefined}
              onClick={() => onToggle(one.id)}
              data-preset={one.id}
            >
              {one.label}
            </ToggleButton>
          );
          return one.unavailable === undefined ? (
            chip
          ) : (
            <Tooltip key={one.id} content={one.unavailable} relationship="description">
              {chip}
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/** 筛选浮层顶上的「常用」：查询预设勾上即叠加为一个条件，与条件行里的同名条件片同进同退 */
export function PresetChips({ checked, playcount, onToggle }: PresetChipsProps) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <ToggleChipGroup
      title={t('query.presets')}
      chips={QUERY_PRESETS.map((preset) => ({
        id: preset.id,
        label: t(PRESET_LABELS[preset.id]),
        checked: checked.has(preset.id),
        unavailable:
          preset.group === PLAYCOUNT_GROUP && playcount === false
            ? t('query.needsPlaycount')
            : undefined,
      }))}
      onToggle={(id) => {
        const preset = QUERY_PRESETS.find((one) => one.id === id);
        if (preset) onToggle(preset.id);
      }}
    />
  );
}
