import { SpinButton, Switch, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import {
  LYRICS_MOTION_PRESETS,
  lyricsMotionKey,
  type LyricsCurve,
  type LyricsMotion,
} from '../lyrics/lyricsMotion.ts';
import type { LyricsView } from '../lyrics/lyricsSettings.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { NumberSetting } from './NumberSetting.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { useSettingsLayout } from './useSettingsLayout.ts';

const useStyles = makeStyles({
  curve: { display: 'flex', columnGap: tokens.spacingHorizontalS },
  point: { width: '84px', minWidth: 0 },
  fill: { flex: 1 },
});

const CURVE_POINTS = ['x1', 'y1', 'x2', 'y2'] as const;

function withPoint(curve: LyricsCurve, index: number, value: number): LyricsCurve {
  const [x1, y1, x2, y2] = curve;
  return [
    index === 0 ? value : x1,
    index === 1 ? value : y1,
    index === 2 ? value : x2,
    index === 3 ? value : y2,
  ];
}

/**
 * 一个视图的动效设置行，位于该视图的展开卡中。第一行选择预设，从属项只在条件满足时显示，不以禁用状态表示。
 * 修改任何一项都会切换到自定义档，见 `LyricsMotionService.customize`
 */
export function LyricsMotionRows({ view }: { readonly view: LyricsView }) {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(lyricsMotionKey);
  const pref = useAtomValueRawSync(service.views[view].pref);
  const motion = useAtomValueRawSync(service.views[view].motion);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const { compact } = useSettingsLayout();
  const customize = (patch: Partial<LyricsMotion>) => service.customize(patch, view);
  const toggle = (name: 'spring' | 'blur' | 'scale' | 'hidePassedLines') => (
    <SettingsRow title={t(`lyrics.${name}`)}>
      {({ labelId, descriptionId }) => (
        <Switch
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={motion[name]}
          onChange={(_, data) => customize({ [name]: data.checked })}
        />
      )}
    </SettingsRow>
  );
  return (
    <>
      <SettingsRow title={t('lyrics.preset')} field>
        {(ids) => (
          <SettingsSelect
            {...ids}
            value={pref.preset}
            options={LYRICS_MOTION_PRESETS.map((value) => ({
              value,
              label: t(`lyrics.preset.${value}`),
            }))}
            onChange={(preset) => service.choosePreset(preset, view)}
          />
        )}
      </SettingsRow>
      {toggle('spring')}
      {!motion.spring && (
        <>
          <NumberSetting
            nested
            label={t('lyrics.transitionMs')}
            value={motion.transitionMs}
            min={0}
            max={2000}
            step={10}
            onChange={(transitionMs) => customize({ transitionMs })}
          />
          <SettingsRow title={t('lyrics.transitionCurve')} field nested>
            {() => (
              <div className={mergeClasses(classes.curve, compact && classes.fill)}>
                {CURVE_POINTS.map((name, index) => (
                  <SpinButton
                    key={name}
                    className={mergeClasses(classes.point, controls.field)}
                    aria-label={`${t('lyrics.transitionCurve')} ${name}`}
                    value={motion.transitionCurve[index] ?? 0}
                    min={index % 2 ? -1 : 0}
                    max={index % 2 ? 2 : 1}
                    step={0.05}
                    onChange={(_, data) => {
                      const next = data.value ?? Number(data.displayValue);
                      if (Number.isFinite(next))
                        customize({
                          transitionCurve: withPoint(motion.transitionCurve, index, next),
                        });
                    }}
                  />
                ))}
              </div>
            )}
          </SettingsRow>
        </>
      )}
      {toggle('blur')}
      {toggle('scale')}
      {motion.spring &&
        motion.scale &&
        (['mass', 'damping', 'stiffness'] as const).map((name) => (
          <NumberSetting
            key={name}
            nested
            label={t(`lyrics.${name}`)}
            value={motion.scaleSpring[name]}
            min={name === 'mass' ? 0.1 : 1}
            max={name === 'mass' ? 10 : name === 'damping' ? 100 : 1000}
            step={name === 'mass' ? 0.1 : 1}
            onChange={(value) =>
              customize({ scaleSpring: { ...motion.scaleSpring, [name]: value } })
            }
          />
        ))}
      {toggle('hidePassedLines')}
      <NumberSetting
        label={t('lyrics.wordFadeWidth')}
        value={motion.wordFadeWidth}
        min={0.0001}
        max={2}
        step={0.05}
        onChange={(wordFadeWidth) => customize({ wordFadeWidth })}
      />
    </>
  );
}
