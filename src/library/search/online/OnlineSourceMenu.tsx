import {
  MenuButton,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../../kit/ScrollMenuPopover.tsx';
import { MENU_SURFACE_MOTION } from '../../../motion/MenuMotion.tsx';
import { PLATFORM_LABELS } from '../../../playback/musicPlatforms.ts';
import type { MusicPlatform } from '../../../server/musicObjects.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import type { OnlineSourceOption } from './onlineSources.ts';

const useStyles = makeStyles({
  // 覆盖 Fluent 按钮默认的 margin: 0，确保靠右对齐的特异性高于预设
  end: { marginLeft: 'auto' },
});

/** 在线检索来源单选菜单：展示当前检索平台，对无可用音源支持的平台禁用并提示原因 */
export function OnlineSourceMenu({
  options,
  selected,
  onChoose,
}: {
  readonly options: readonly OnlineSourceOption[];
  readonly selected: MusicPlatform;
  onChoose(platform: MusicPlatform): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const styles = useStyles();
  const name = t(PLATFORM_LABELS[selected]);
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      checkedValues={{ source: [selected] }}
      onCheckedValueChange={(_, data) => {
        const next = options.find((option) => data.checkedItems.includes(option.platform));
        if (next?.available) onChoose(next.platform);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuButton
          appearance="subtle"
          className={mergeClasses(controls.icon, styles.end)}
          aria-label={t('online.sourceButton', { source: name })}
          data-online-source={selected}
        >
          {name}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('online.source')}>
          {options.map((option) => {
            const label = t(PLATFORM_LABELS[option.platform]);
            const item = (
              <MenuItemRadio
                key={option.platform}
                name="source"
                value={option.platform}
                disabled={!option.available}
                data-online-source-option={option.platform}
              >
                {label}
              </MenuItemRadio>
            );
            return option.available ? (
              item
            ) : (
              <Tooltip
                key={option.platform}
                content={t('online.sourceUnavailable', { platform: label })}
                relationship="description"
              >
                {item}
              </Tooltip>
            );
          })}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
