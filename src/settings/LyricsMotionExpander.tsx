import { SpinButton, Switch, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Settings20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import {
  LYRICS_MOTION_PRESETS,
  lyricsMotionKey,
  type LyricsCurve,
} from '../lyrics/lyricsMotion.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { NumberSetting } from './NumberSetting.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
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
 * 歌词动效一张卡：卡头选预设，下面是各项。从属项按条件出现，不置灰：弹簧关时才有行移动的过渡时长与曲线，
 * 弹簧与缩放都开时才有缩放弹簧的质量、阻尼、刚度。改任何一项都转到自定义档，改的是此刻生效的那一套
 */
export function LyricsMotionExpander() {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(lyricsMotionKey);
  const pref = useAtomValueRawSync(service.pref);
  const motion = useAtomValueRawSync(service.motion);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const { compact } = useSettingsLayout();
  const toggle = (name: 'spring' | 'blur' | 'scale' | 'hidePassedLines') => (
    <SettingsRow title={t(`lyrics.${name}`)}>
      {({ labelId, descriptionId }) => (
        <Switch
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={motion[name]}
          onChange={(_, data) => service.customize({ [name]: data.checked })}
        />
      )}
    </SettingsRow>
  );
  return (
    <SettingsExpander
      icon={<Settings20Regular />}
      title={t('lyrics.preset')}
      field
      defaultOpen={false}
      control={(ids) => (
        <SettingsSelect
          {...ids}
          value={pref.preset}
          options={LYRICS_MOTION_PRESETS.map((value) => ({
            value,
            label: t(`lyrics.preset.${value}`),
          }))}
          onChange={service.choosePreset}
        />
      )}
    >
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
            onChange={(transitionMs) => service.customize({ transitionMs })}
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
                        service.customize({
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
              service.customize({ scaleSpring: { ...motion.scaleSpring, [name]: value } })
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
        onChange={(wordFadeWidth) => service.customize({ wordFadeWidth })}
      />
    </SettingsExpander>
  );
}
