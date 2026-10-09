import { Portal } from '@fluentui/react-components';
import { ImmersiveTheme } from './ImmersiveTheme.tsx';
import { ImmersiveView } from './ImmersiveView.tsx';
import type { ImmersiveShell } from './immersiveShell.ts';
import { ViewServicesContext, type ViewServices } from './viewServices.ts';

/**
 * 地点 `nowPlaying`：正在播放全屏页。中央区域的页面层裁在内容卡里、过渡时还带缩放，盖不住整窗，
 * 所以视图经 `Portal` 挂到窗口顶层，页面层里什么都不画。这一页不再是当前记录时视图照挂着播完退场，
 * 随页面层一起移走。
 */
export function NowPlayingPage({
  current,
  shell,
  services,
}: {
  readonly current: boolean;
  readonly shell: ImmersiveShell | null;
  readonly services: ViewServices;
}) {
  return (
    <Portal>
      <ImmersiveTheme>
        <ViewServicesContext value={services}>
          <ImmersiveView shell={shell} current={current} />
        </ViewServicesContext>
      </ImmersiveTheme>
    </Portal>
  );
}
