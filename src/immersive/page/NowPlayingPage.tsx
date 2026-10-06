import { Portal } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useMemo } from 'react';
import { historyAtom } from '../../nav/navHistory.ts';
import { PageEntryContext } from '../../nav/usePageSnapshot.ts';
import { ImmersiveTheme } from './ImmersiveTheme.tsx';
import { ImmersiveView } from './ImmersiveView.tsx';
import { useImmersiveServices } from './useImmersiveServices.ts';
import { ViewServicesContext, type ViewServices } from './viewServices.ts';
import { useService } from '../../kit/useService.ts';
import { playbackKey } from '../../playback/playbackContract.ts';

/**
 * 地点 `nowPlaying`：正在播放全屏页。中央区域的页面层裁在内容卡里、过渡时还带缩放，盖不住整窗，
 * 所以视图经 `Portal` 挂到窗口顶层，页面层里什么都不画。这一页不再是当前记录时视图照挂着播完退场，
 * 随页面层一起移走。
 */
export function NowPlayingPage() {
  const entry = useContext(PageEntryContext);
  const current = useAtomValueRawSync(historyAtom).entry === entry;
  const running = useImmersiveServices(current);
  const playback = useService(playbackKey);
  const services = useMemo<ViewServices>(
    () => ({
      playback,
      cover: running?.cover ?? null,
      spectrum: running?.spectrum ?? null,
      terrain: running?.terrain ?? null,
      stereo: running?.stereo ?? null,
    }),
    [playback, running],
  );
  return (
    <Portal>
      <ImmersiveTheme>
        <ViewServicesContext value={services}>
          <ImmersiveView shell={running?.shell ?? null} current={current} />
        </ViewServicesContext>
      </ImmersiveTheme>
    </Portal>
  );
}
