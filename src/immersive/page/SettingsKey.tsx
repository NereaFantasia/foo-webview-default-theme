import { Button, Tooltip } from '@fluentui/react-components';
import { Options20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { backdropDegradedAtom } from '../backdrop/backdropState.ts';
import { useControlKeyClasses } from '../scene/controlKeyStyles.ts';
import { enterEdit } from './editSession.ts';

/**
 * 控制层左边的第一颗键：进入设置的编辑
 *
 * 沉浸相关的设置（视图样式、预设与它的可调项、背景、性能）都在编辑里，歌词的工具另有歌词工具键。
 * 编辑时顶部的键全部藏起，所以这颗键没有按下态；退出编辑靠编辑条上的「完成」「取消」与 Esc。两种场景都有这颗键
 */
export function SettingsKey() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const keys = useControlKeyClasses(useAtomValueRawSync(backdropDegradedAtom));
  return (
    <Tooltip content={t('immersive.settings')} relationship="label">
      <Button
        appearance="transparent"
        shape="circular"
        className={keys.key}
        icon={<Options20Regular />}
        data-settings-key
        onClick={() => enterEdit(store)}
      />
    </Tooltip>
  );
}
