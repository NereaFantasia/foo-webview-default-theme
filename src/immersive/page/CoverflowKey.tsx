import { Button, Tooltip } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { createPortal } from 'react-dom';
import { translateAtom } from '../../i18n/locale.ts';
import { sceneStateAtom } from '../scene/sceneActions.ts';
import { useControlSlots, useSceneActions } from '../scene/sceneContext.ts';
import { useControlKeyClasses } from './controlKeyStyles.ts';
import { CoverflowIcon } from './CoverflowIcon.tsx';

/**
 * 顶栏 Coverflow 模式切换控制键
 *
 * 挂载至顶栏常驻插槽，在折叠场景下保持可见；点击在封面流模式与当前预设视图间切换
 */
export function CoverflowKey() {
  const t = useAtomValueRawSync(translateAtom);
  const actions = useSceneActions();
  const on = useAtomValueRawSync(sceneStateAtom).mode === 'coverflow';
  const keys = useControlKeyClasses();
  const slots = useControlSlots();
  const label = t('immersive.coverflow');
  const key = (
    <Tooltip content={label} relationship="label">
      <Button
        appearance="transparent"
        shape="circular"
        className={keys.key}
        icon={<CoverflowIcon />}
        aria-pressed={on}
        data-coverflow-key
        onClick={() => actions.setMode(on ? 'none' : 'coverflow')}
      />
    </Tooltip>
  );
  if (!slots) return key;
  return slots.views ? createPortal(key, slots.views) : null;
}
