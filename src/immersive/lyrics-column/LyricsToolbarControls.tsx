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
  LYRICS_ALIGNS,
  LYRICS_FONT_SIZE_RANGE,
  type LyricsAlign,
} from '../../lyrics/lyricsDisplay.ts';
import { lyricsKey } from '../../lyrics/lyricsService.ts';
import { createWheelStepper } from '../../playback/volume/wheelSteps.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import styles from './LyricsToolbar.module.css';
import { FONT_SIZE_STEP, formatOffset, stepFontSize, stepOffset } from './lyricsToolbar.ts';
import { RomanizationIcon } from './RomanizationIcon.tsx';
import { useToolbarStyles } from './toolbarStyles.ts';

/** 控件排布模式：tile 适用于宽档磁贴布局，panel 适用于下拉面板竖向布局 */
export type ControlLayout = 'tile' | 'panel';

/** 译文与音译开关布局形态：tall 适用于宽档整高图标，icon 适用于窄档图标，panel 适用于面板开关行 */
export type ToggleLayout = 'tall' | 'icon' | 'panel';

/**
 * 歌词字号调节控件
 *
 * 磁贴形态展示名称、数值与步进按键；面板形态呈现单行滑块与读数；
 * 支持鼠标滚轮以 2px 步进平滑调节（换算逻辑对齐 wheelSteps 步进器）
 */
export function FontSizeControl({
  layout,
  available,
}: {
  readonly layout: ControlLayout;
  readonly available: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useToolbarStyles();
  const controls = useViewControlStyles();
  const service = useService(lyricsDisplayKey);
  const { fontSize } = useAtomValueRawSync(service.display);
  const [stepper] = useState(createWheelStepper);
  const { min, max } = LYRICS_FONT_SIZE_RANGE;
  const set = (size: number) => void service.update({ fontSize: size });
  const onWheel = (event: WheelEvent<HTMLElement>) => {
    const steps = stepper(event);
    if (available && steps !== 0) set(stepFontSize(fontSize, steps));
  };
  const slider = (
    <Slider
      className={mergeClasses(styles.slider, classes.slider)}
      size="small"
      min={min}
      max={max}
      step={FONT_SIZE_STEP}
      value={fontSize}
      disabled={!available}
      aria-label={t('lyrics.fontSize')}
      onChange={(_, data) => set(data.value)}
    />
  );
  if (layout === 'panel')
    return (
      <div className={styles.row} onWheel={onWheel}>
        <span>{t('lyrics.fontSize')}</span>
        {slider}
        <span className={styles.rowValue}>{fontSize}</span>
      </div>
    );
  return (
    <div
      className={mergeClasses(styles.tile, styles.tileFont)}
      role="group"
      aria-label={t('lyrics.fontSize')}
      data-disabled={!available || undefined}
      onWheel={onWheel}
    >
      <div className={styles.tileHead}>
        <span>{t('lyrics.fontSize')}</span>
        <span className={styles.tileValue}>{fontSize}</span>
      </div>
      <div className={styles.tileBody}>
        <Tooltip content={t('lyrics.fontSmaller')} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            shape="rounded"
            className={mergeClasses(classes.fontStep, controls.icon)}
            disabled={!available || fontSize <= min}
            onClick={() => set(stepFontSize(fontSize, -1))}
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
            disabled={!available || fontSize >= max}
            onClick={() => set(stepFontSize(fontSize, 1))}
          >
            A+
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

const STEPS = [-0.5, -0.1, 0.1, 0.5] as const;

/** 时间校正：块里是名字加数值（不为零时带恢复键）、下面四个步进，面板里是大号数值、四个步进与恢复原时间 */
export function TimingControl({
  layout,
  available,
}: {
  readonly layout: ControlLayout;
  readonly available: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useToolbarStyles();
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
 * 译文与音译开关控件
 *
 * 宽档渲染为整高图标按钮，窄档渲染为标准图标，面板内渲染为开关行；
 * 当前曲目缺失对应歌词属性时禁用但保持可聚焦与悬浮提示
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
  const classes = useToolbarStyles();
  const controls = useViewControlStyles();
  const service = useService(lyricsDisplayKey);
  const checked = useAtomValueRawSync(service.display)[field];
  const labelId = useId();
  const label = t(`lyrics.${field}`);
  const toggle = () => void service.update({ [field]: !checked });
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
 * 文字对齐控件
 *
 * 条上是一个轮换键：图标是当前的对齐，点一下换到下一种（居左、居中、居右）；面板里是三个并排的图标键，
 * 选中的那个按下。没有歌词时置灰，保持可聚焦与悬浮提示
 */
export function AlignControl({
  layout,
  available,
}: {
  readonly layout: ToggleLayout;
  readonly available: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useToolbarStyles();
  const controls = useViewControlStyles();
  const service = useService(lyricsDisplayKey);
  const { align } = useAtomValueRawSync(service.display);
  const labelId = useId();
  const set = (next: LyricsAlign) => void service.update({ align: next });
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
