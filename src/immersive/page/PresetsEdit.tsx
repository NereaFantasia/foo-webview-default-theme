import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useMemo } from 'react';
import type { PresetEntry } from '../presets/presets.ts';
import { sceneStateAtom } from '../scene/sceneActions.ts';
import { useSceneActions } from '../scene/sceneContext.ts';
import { BackdropOptionsSection } from './BackdropOptionsSection.tsx';
import { EditLayer } from './EditLayer.tsx';
import { EditHost, type EditSpec } from './EditHost.tsx';
import { EDIT_BACKGROUND, EDIT_MORE, EDIT_VIEW, editOpenAtom } from './editSession.ts';
import { GeneralSection, PresetChoiceSection, PresetGroupSection } from './PresetSections.tsx';
import { BackdropSection, PerformanceSection, ViewStyleSection } from './SettingsSections.tsx';

/**
 * 歌词视图的设置编辑：视图（视图样式、预设、共用两项）、当前预设的各组、背景（渲染器与它的可调项）、其他（性能）
 *
 * 预设的组按它的声明生成（`PresetEntry.panel`），一组一个分类，标题就是分类名，`target` 是要描的元素；
 * 换预设后分类表跟着变。卡片都停在右边：两个预设的主体（封面）都在左半。
 * 放在预设场景里，因为预设单选、拖柄要用场景上下文；Coverflow 开着时进编辑先退回原来的版式。
 * 画面上那一层（拦截、描框、拖柄）在 `EditLayer`
 */
export function PresetsEdit({
  preset,
  centered,
}: {
  readonly preset: PresetEntry;
  /** 版式此刻是不是居中（侧栏收起）：拖柄按它算位置 */
  readonly centered: boolean;
}) {
  const actions = useSceneActions();
  const open = useAtomValueRawSync(editOpenAtom);
  const coverflow = useAtomValueRawSync(sceneStateAtom).mode === 'coverflow';
  useEffect(() => {
    if (open && coverflow) actions.setMode('none');
  }, [actions, open, coverflow]);
  const categories = useMemo<readonly [EditSpec, ...EditSpec[]]>(
    () => [
      {
        id: EDIT_VIEW,
        label: 'immersive.edit.view',
        dock: 'end',
        content: (
          <>
            <ViewStyleSection />
            <PresetChoiceSection />
            <GeneralSection />
          </>
        ),
      },
      ...preset.panel.map((group): EditSpec => ({
        id: group.title,
        label: group.title,
        dock: 'end',
        target: group.target,
        content: <PresetGroupSection entry={preset} group={group} />,
      })),
      {
        id: EDIT_BACKGROUND,
        label: 'immersive.settings.background',
        dock: 'end',
        content: (
          <>
            <BackdropSection />
            <BackdropOptionsSection />
          </>
        ),
      },
      {
        id: EDIT_MORE,
        label: 'immersive.settings.more',
        dock: 'end',
        content: <PerformanceSection titled={false} />,
      },
    ],
    [preset],
  );
  return (
    <EditHost
      categories={categories}
      switchPreset={actions.switchPreset}
      layer={(props) => <EditLayer {...props} preset={preset} centered={centered} />}
    />
  );
}
