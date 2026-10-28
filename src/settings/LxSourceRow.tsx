import { Button, MenuItem, MenuList, MenuTrigger, Switch } from '@fluentui/react-components';
import {
  ArrowDown16Regular,
  ArrowUp16Regular,
  MoreHorizontal16Regular,
  Person16Regular,
  Tag16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import { Metadata, MetadataItem } from '../kit/Metadata.tsx';
import { ScrollMenu as Menu, ScrollMenuPopover as MenuPopover } from '../kit/ScrollMenuPopover.tsx';
import type { MusicLxSource } from '../server/musicLxSources.ts';
import type { MusicPlatform } from '../server/musicObjects.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { LxPlatformStatus } from './LxPlatformStatus.tsx';
import { checkable } from './lxHealthText.ts';
import { SettingsRow } from './SettingsRow.tsx';

interface LxSourceRowProps {
  readonly source: MusicLxSource;
  /** 存在正在进行的变更操作，为 true 时整行交互禁用 */
  readonly busy: boolean;
  readonly first: boolean;
  readonly last: boolean;
  /** 当前正在检测连通性的平台集合 */
  readonly checking: ReadonlySet<MusicPlatform>;
  readonly onToggle: (enabled: boolean) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onCheck: () => void;
  readonly onReplace: () => void;
  readonly onRemove: () => void;
}

/**
 * 音源脚本信息与操作行组件
 *
 * 展示音源元数据、连通状态与错误反馈，并提供启停、排序及管理操作菜单
 */
export function LxSourceRow({
  source,
  busy,
  first,
  last,
  checking,
  onToggle,
  onMove,
  onCheck,
  onReplace,
  onRemove,
}: LxSourceRowProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const controls = useViewControlStyles();
  const platforms = new Intl.ListFormat(locale, { type: 'conjunction', style: 'narrow' });
  return (
    <SettingsRow
      title={source.name}
      meta={
        (source.version || source.author) && (
          <Metadata>
            {source.version && (
              <MetadataItem icon={<Tag16Regular />} label={t('online.lxVersion')}>
                {source.version}
              </MetadataItem>
            )}
            {source.author && (
              <MetadataItem icon={<Person16Regular />} label={t('online.lxAuthor')}>
                {source.author}
              </MetadataItem>
            )}
          </Metadata>
        )
      }
      description={
        source.failed
          ? source.error
            ? t('online.lxScriptFailedWhy', { reason: source.error })
            : t('online.lxScriptFailed')
          : source.enabled
            ? undefined
            : platforms.format(source.platforms.map((platform) => t(`online.platform.${platform}`)))
      }
      error={source.failed}
      clamp={source.failed}
      disabled={!source.enabled}
      feedback={
        source.enabled &&
        !source.failed && (
          <LxPlatformStatus
            platforms={source.platforms}
            health={source.health}
            checking={checking}
          />
        )
      }
    >
      {(ids) => (
        <>
          <Switch
            checked={source.enabled}
            disabled={busy}
            aria-labelledby={ids.labelId}
            aria-describedby={ids.descriptionId}
            onChange={(_, data) => onToggle(data.checked)}
          />
          {([-1, 1] as const).map((delta) => (
            <Button
              key={delta}
              appearance="subtle"
              className={controls.icon}
              icon={delta < 0 ? <ArrowUp16Regular /> : <ArrowDown16Regular />}
              aria-label={t(delta < 0 ? 'online.lxMoveUp' : 'online.lxMoveDown', {
                name: source.name,
              })}
              disabled={busy || (delta < 0 ? first : last)}
              onClick={() => onMove(delta)}
            />
          ))}
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
                className={controls.icon}
                icon={<MoreHorizontal16Regular />}
                aria-label={t('online.lxMore', { name: source.name })}
                disabled={busy}
              />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem disabled={!checkable(source) || checking.size > 0} onClick={onCheck}>
                  {t('online.lxCheck')}
                </MenuItem>
                <MenuItem onClick={onReplace}>{t('online.lxReplace')}</MenuItem>
                <MenuItem onClick={onRemove}>{t('online.lxRemove')}</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </>
      )}
    </SettingsRow>
  );
}
