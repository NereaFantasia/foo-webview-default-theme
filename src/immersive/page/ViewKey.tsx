import {
  Button,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  type MenuProps,
} from '@fluentui/react-components';
import { Checkmark16Regular, WindowMultipleSwap20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { Menu } from '../../motion/Surfaces.tsx';
import { MenuSurface as MenuPopover } from '../../theme/MenuSurface.tsx';
import { backdropDegradedAtom } from '../backdrop/backdropState.ts';
import { ACRYLIC_FILTER, ACRYLIC_PANEL_TINT, ACRYLIC_SOLID_FILL } from '../scene/acrylic.ts';
import { useControlKeyClasses } from './controlKeyStyles.ts';
import {
  chooseImmersiveScene,
  IMMERSIVE_SCENES,
  immersiveSceneAtom,
  type ImmersiveScene,
} from './immersivePrefs.ts';

/** 映射视图样式本地化多语言文案键，与设置页保持一致 */
const SCENE_LABELS: Record<ImmersiveScene, MessageKey> = {
  paper: 'settings.immersiveScenePaper',
  presets: 'settings.immersiveScenePresets',
};

/** 视图样式单选选项组标识 */
const GROUP = 'immersiveScene';

const useStyles = makeStyles({
  // 菜单浮层底色：采用统一 Acrylic 材质与着色层，圆角与描边由垫板层管理
  popover: {
    width: '248px',
    '& [data-menu-backplate]': {
      backgroundColor: ACRYLIC_PANEL_TINT,
      backdropFilter: ACRYLIC_FILTER,
      ...shorthands.borderWidth(0),
      '@media (prefers-reduced-transparency: reduce)': {
        backgroundColor: ACRYLIC_SOLID_FILL,
        backdropFilter: 'none',
      },
    },
  },
  solid: {
    '& [data-menu-backplate]': {
      backgroundColor: ACRYLIC_SOLID_FILL,
      backdropFilter: 'none',
    },
  },
  // 行高 48px：左侧为 48×32 示意缩略图，右侧为文本与选中勾选标记
  item: {
    '& .fui-MenuList [role="menuitemradio"]': { minHeight: '48px' },
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
  },
  thumb: {
    display: 'block',
    flex: 'none',
    width: '48px',
    height: '32px',
    borderRadius: tokens.borderRadiusLarge,
    color: tokens.colorNeutralForeground1,
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralForeground1} 8%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tokens.colorNeutralForeground1} 15%, transparent)`,
  },
  tick: { flex: 'none', width: '16px', height: '16px' },
});

/** 视图样式线框示意图标；图纸模式展示刻度环与折线，歌词模式展示封面与文本骨架 */
function SceneThumb({
  scene,
  className,
}: {
  readonly scene: ImmersiveScene;
  readonly className: string;
}) {
  return (
    <svg className={className} viewBox="0 0 48 32" fill="none" aria-hidden focusable="false">
      {scene === 'paper' ? (
        <>
          <circle
            cx="14"
            cy="16"
            r="9"
            stroke="currentColor"
            strokeOpacity=".6"
            strokeWidth="1.5"
          />
          <circle
            cx="14"
            cy="16"
            r="4"
            stroke="currentColor"
            strokeOpacity=".4"
            strokeWidth="1.5"
          />
          <path
            d="M28 22l4-6 4 3 4-8"
            stroke="currentColor"
            strokeOpacity=".6"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="28" y="25" width="14" height="2" rx="1" fill="currentColor" fillOpacity=".3" />
        </>
      ) : (
        <>
          <rect x="5" y="6" width="18" height="18" rx="2.5" fill="currentColor" fillOpacity=".65" />
          <rect x="29" y="7" width="14" height="3" rx="1.5" fill="currentColor" fillOpacity=".5" />
          <rect x="29" y="13" width="14" height="3" rx="1.5" fill="currentColor" fillOpacity=".3" />
          <rect x="29" y="19" width="14" height="3" rx="1.5" fill="currentColor" fillOpacity=".3" />
        </>
      )}
    </svg>
  );
}

const isScene = (value: string | undefined): value is ImmersiveScene =>
  IMMERSIVE_SCENES.some((scene) => scene === value);

/**
 * 沉浸模式顶栏视图切换控制键
 *
 * 在图纸与预设歌词视图间切换当前偏好设置；弹窗内以单选列表展示各视图缩略图，拦截向下键冒泡以避免触发外层音量控制，
 * 菜单内 Esc 仅关闭浮层而不退出沉浸视图
 */
export function ViewKey() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const scene = useAtomValueRawSync(immersiveSceneAtom);
  const degraded = useAtomValueRawSync(backdropDegradedAtom);
  const keys = useControlKeyClasses();
  const classes = useStyles();
  const pick: MenuProps['onCheckedValueChange'] = (_, { checkedItems }) => {
    const next = checkedItems[0];
    if (isScene(next) && next !== scene) chooseImmersiveScene(store, next);
  };
  const label = t('immersive.view');
  return (
    <Menu checkedValues={{ [GROUP]: [scene] }} onCheckedValueChange={pick}>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={label} relationship="label">
          <Button
            appearance="transparent"
            shape="circular"
            className={keys.key}
            icon={<WindowMultipleSwap20Regular />}
            data-view-key
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') event.stopPropagation();
            }}
          />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover
        className={mergeClasses(classes.popover, classes.item, degraded && classes.solid)}
      >
        <MenuList aria-label={label} data-view-menu>
          {IMMERSIVE_SCENES.map((item) => (
            <MenuItemRadio
              key={item}
              name={GROUP}
              value={item}
              checkmark={null}
              secondaryContent={
                item === scene ? <Checkmark16Regular className={classes.tick} /> : undefined
              }
              data-view-scene={item}
            >
              <span className={classes.row}>
                <SceneThumb scene={item} className={classes.thumb} />
                <span>{t(SCENE_LABELS[item])}</span>
              </span>
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
