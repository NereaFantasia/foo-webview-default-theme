import {
  Button,
  Slider,
  Switch,
  ToggleButton,
  Tooltip,
  mergeClasses,
} from '@fluentui/react-components';
import {
  ArrowReset20Regular,
  TextAlignCenter20Regular,
  TextAlignLeft20Regular,
  TextAlignRight20Regular,
  Translate20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useState, type ReactElement, type WheelEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import {
  lyricsDisplayKey,
  lyricsScaleFontSize,
  lyricsScalePercent,
  LYRICS_ALIGNS,
  LYRICS_SCALE_RANGE,
  type LyricsAlign,
} from '../../lyrics/lyricsDisplay.ts';
import { lyricsKey } from '../../lyrics/lyricsService.ts';
import { createWheelStepper } from '../../playback/volume/wheelSteps.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import styles from './LyricsToolbar.module.css';
import { formatOffset, stepOffset, stepScale } from './lyricsToolbar.ts';
import { RomanizationIcon } from './RomanizationIcon.tsx';
import { useToolsStyles } from './toolsStyles.ts';

/** 控件的形态：`tile` 用于宽档的磁贴，`panel` 用于弹出面板里的竖排 */
export type ControlLayout = 'tile' | 'panel';

/** 开关与对齐控件的形态：`tall` 用于宽档的整高图标键，`icon` 用于中档与窄档的图标键，`panel` 用于面板里的一行 */
export type ToggleLayout = 'tall' | 'icon' | 'panel';

/**
 * 沉浸视图歌词的缩放控件，形态由 `layout` 决定。
 * 在控件上滚动滚轮按缩放步长调节，滚轮的步数换算与其他步进器相同（`createWheelStepper`）
 */
export function FontSizeControl({
  layout,
  available,
}: {
  readonly layout: ControlLayout;
  readonly available: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useToolsStyles();
  const controls = useViewControlStyles();
  const service = useService(lyricsDisplayKey);
  const percent = lyricsScalePercent(useAtomValueRawSync(service.immersiveDisplay).fontSize);
  const [stepper] = useState(createWheelStepper);
  const { min, max, step } = LYRICS_SCALE_RANGE;
  const set = (value: number) =>
    void service.update({ fontSize: lyricsScaleFontSize(value) }, 'immersive');
  const onWheel = (event: WheelEvent<HTMLElement>) => {
    const steps = stepper(event);
    if (available && steps !== 0) set(stepScale(percent, steps));
  };
  const slider = (
    <Slider
      className={mergeClasses(styles.slider, classes.slider)}
      size="small"
      min={min}
      max={max}
      step={step}
      value={percent}
      disabled={!available}
      aria-label={t('lyrics.zoom')}
      onChange={(_, data) => set(data.value)}
    />
  );
  if (layout === 'panel')
    return (
      <div className={styles.row} onWheel={onWheel}>
        <span>{t('lyrics.zoom')}</span>
        {slider}
        <span className={styles.rowValue}>{percent}%</span>
      </div>
    );
  return (
    <div
      className={mergeClasses(styles.tile, styles.tileFont)}
      role="group"
      aria-label={t('lyrics.zoom')}
      data-disabled={!available || undefined}
      onWheel={onWheel}
    >
      <div className={styles.tileHead}>
        <span>{t('lyrics.zoom')}</span>
        <span className={styles.tileValue}>{percent}%</span>
      </div>
      <div className={styles.tileBody}>
        <Tooltip content={t('lyrics.fontSmaller')} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            shape="rounded"
            className={mergeClasses(classes.fontStep, controls.icon)}
            disabled={!available || percent <= min}
            onClick={() => set(stepScale(percent, -1))}
          >
            A−
          </Button>
        </Tooltip>
        {slider}
        <Tooltip content={t('lyrics.fontLarger')} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            shape="rounded"
            className={mergeClasses(classes.fontStep, classes.fontStepLarge, controls.icon)}
            disabled={!available || percent >= max}
            onClick={() => set(stepScale(percent, 1))}
          >
            A+
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

const STEPS = [-0.5, -0.1, 0.1, 0.5] as const;

/**
 * 歌词的时间校正控件，形态由 `layout` 决定。两种形态都有四个步进键与恢复原时间的按钮，
 * 磁贴形态只在校正值不为零时显示恢复键
 */
export function TimingControl({
  layout,
  available,
}: {
  readonly layout: ControlLayout;
  readonly available: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useToolsStyles();
  const controls = useViewControlStyles();
  const service = useService(lyricsKey);
  const offset = useAtomValueRawSync(service.offset);
  const label = (delta: number) =>
    t(delta < 0 ? 'lyrics.earlierBy' : 'lyrics.laterBy', { seconds: Math.abs(delta) });
  const steps = (
    <div className={styles.steps}>
      {STEPS.map((delta) => (
        <Button
          key={delta}
          size="small"
          className={mergeClasses(controls.field, classes.stepButton)}
          aria-label={label(delta)}
          disabled={!available}
          onClick={() => void service.setOffset(stepOffset(offset, delta))}
        >
          {delta > 0 ? `+${delta}` : `−${-delta}`}
        </Button>
      ))}
    </div>
  );
  if (layout === 'panel')
    return (
      <div className={styles.stack}>
        <div className={styles.row}>
          <span>{t('lyrics.timing')}</span>
          <span className={styles.big}>{formatOffset(offset)}</span>
        </div>
        {steps}
        <Button
          appearance="subtle"
          size="small"
          className={mergeClasses(styles.reset, controls.field)}
          disabled={!available || offset === 0}
          onClick={() => void service.setOffset(0)}
        >
          {t('lyrics.resetTime')}
        </Button>
      </div>
    );
  return (
    <div
      className={mergeClasses(styles.tile, styles.tileTiming)}
      role="group"
      aria-label={t('lyrics.timing')}
      data-disabled={!available || undefined}
    >
      <div className={styles.tileHead}>
        <span>{t('lyrics.timing')}</span>
        <span className={styles.tileValue}>
          {available && offset !== 0 && (
            <Tooltip content={t('lyrics.resetTime')} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                shape="rounded"
                className={mergeClasses(classes.resetKey, controls.icon)}
                icon={<ArrowReset20Regular />}
                onClick={() => void service.setOffset(0)}
              />
            </Tooltip>
          )}
          {formatOffset(offset)}
        </span>
      </div>
      <div className={styles.tileBody}>{steps}</div>
    </div>
  );
}

/**
 * 沉浸视图歌词的译文或音译开关，形态由 `layout` 决定
 *
 * `available` 为假时禁用。按钮形态仍可获得焦点并显示悬浮提示，面板形态的开关不可获得焦点
 */
export function DisplayToggle({
  field,
  layout,
  available,
}: {
  readonly field: 'showTranslation' | 'showRomanization';
  readonly layout: ToggleLayout;
  readonly available: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useToolsStyles();
  const controls = useViewControlStyles();
  const service = useService(lyricsDisplayKey);
  const checked = useAtomValueRawSync(service.immersiveDisplay)[field];
  const labelId = useId();
  const label = t(`lyrics.${field}`);
  const toggle = () => void service.update({ [field]: !checked }, 'immersive');
  const translation = field === 'showTranslation';
  const icon = translation ? <Translate20Regular /> : <RomanizationIcon />;
  const tool = translation ? 'translation' : 'romanization';
  if (layout === 'panel')
    return (
      <div className={styles.row}>
        <span id={labelId}>{label}</span>
        <Switch
          aria-labelledby={labelId}
          checked={checked}
          disabled={!available}
          onChange={toggle}
        />
      </div>
    );
  return (
    <Tooltip content={label} relationship="label">
      <ToggleButton
        appearance="subtle"
        shape="rounded"
        className={mergeClasses(classes.key, controls.icon, layout === 'tall' && classes.tall)}
        icon={icon}
        checked={checked}
        disabledFocusable={!available}
        data-lyrics-tool={tool}
        onClick={toggle}
      />
    </Tooltip>
  );
}

const ALIGN_ICONS: Readonly<Record<LyricsAlign, ReactElement>> = {
  left: <TextAlignLeft20Regular />,
  center: <TextAlignCenter20Regular />,
  right: <TextAlignRight20Regular />,
};

/**
 * 沉浸视图歌词的文字对齐控件
 *
 * 工具条上是一个轮换键，图标表示当前的对齐方式，点击后依次换到居左、居中、居右。
 * 面板里是三个并排的图标键，当前方式处于按下状态。
 * `available` 为假时禁用，但仍可获得焦点并显示悬浮提示
 */
export function AlignControl({
  layout,
  available,
}: {
  readonly layout: ToggleLayout;
  readonly available: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useToolsStyles();
  const controls = useViewControlStyles();
  const service = useService(lyricsDisplayKey);
  const { align } = useAtomValueRawSync(service.immersiveDisplay);
  const labelId = useId();
  const set = (next: LyricsAlign) => void service.update({ align: next }, 'immersive');
  if (layout === 'panel')
    return (
      <div className={styles.row}>
        <span id={labelId}>{t('lyrics.textAlign')}</span>
        <div className={styles.segment} role="group" aria-labelledby={labelId}>
          {LYRICS_ALIGNS.map((value) => (
            <Tooltip key={value} content={t(`lyrics.textAlign.${value}`)} relationship="label">
              <ToggleButton
                appearance="subtle"
                shape="rounded"
                className={mergeClasses(classes.key, controls.icon)}
                icon={ALIGN_ICONS[value]}
                checked={align === value}
                disabledFocusable={!available}
                data-lyrics-tool={`align-${value}`}
                onClick={() => set(value)}
              />
            </Tooltip>
          ))}
        </div>
      </div>
    );
  const next = LYRICS_ALIGNS[(LYRICS_ALIGNS.indexOf(align) + 1) % LYRICS_ALIGNS.length] ?? 'left';
  return (
    <Tooltip
      content={t('lyrics.textAlignIs', { value: t(`lyrics.textAlign.${align}`) })}
      relationship="label"
    >
      <Button
        appearance="subtle"
        shape="rounded"
        className={mergeClasses(classes.key, controls.icon, layout === 'tall' && classes.tall)}
        icon={ALIGN_ICONS[align]}
        disabledFocusable={!available}
        data-lyrics-tool="align"
        onClick={() => set(next)}
      />
    </Tooltip>
  );
}
