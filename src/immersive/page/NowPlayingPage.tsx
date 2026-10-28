import { Portal } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import type { LeaseRegistry } from '../lease/leaseRegistry.ts';
import { LeaseContext } from '../lease/useLease.ts';
import { ImmersiveTheme } from './ImmersiveTheme.tsx';
import { ImmersiveView } from './ImmersiveView.tsx';
import { immersiveSceneAtom } from './immersivePrefs.ts';
import type { ImmersiveShell } from './immersiveShell.ts';
import { ViewServicesContext, type ViewServices } from './viewServices.ts';

/**
 * 地点 `nowPlaying`：正在播放全屏页。中央区域的页面层裁在内容卡里、过渡时还带缩放，盖不住整窗，
 * 所以视图经 `Portal` 挂到窗口顶层，页面层里什么都不画。这一页不再是当前记录时视图照挂着播完退场的过渡，
 * 随页面层一起移走
 *
 * 画哪个场景看偏好 `immersiveSceneAtom`；预设场景固定深色，图纸场景深浅跟整窗。`services` 只有图纸场景用，
 * `leases` 是预设场景里的元素借按需服务的登记处，首帧与页面已离开时为 null
 */
export function NowPlayingPage({
  current,
  shell,
  services,
  leases,
}: {
  readonly current: boolean;
  readonly shell: ImmersiveShell | null;
  readonly services: ViewServices;
  readonly leases: LeaseRegistry | null;
}) {
  const scene = useAtomValueRawSync(immersiveSceneAtom);
  return (
    <Portal>
      <ImmersiveTheme scheme={scene === 'presets' ? 'dark' : undefined}>
        <ViewServicesContext value={services}>
          <LeaseContext value={leases}>
            <ImmersiveView shell={shell} current={current} scene={scene} />
          </LeaseContext>
        </ViewServicesContext>
      </ImmersiveTheme>
    </Portal>
  );
}
