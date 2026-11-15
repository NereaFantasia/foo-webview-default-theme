import type { MusicTrack } from '../../server/musicObjects.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { OnlineTrackMenu } from '../search/online/OnlineTrackMenu.tsx';
import { useHomeServices } from './homeContext.ts';

/** 首页在线行里打开的曲目菜单：在哪里、对着哪一首，菜单里的「播放」怎么播由所在的行定 */
export interface HomeTrackMenuState {
  readonly at: TablePoint;
  readonly tracks: readonly MusicTrack[];
  /** 从这一首起播它所在的那一串 */
  readonly play: () => void;
}

/** 首页在线行里一首曲目的右键菜单；入队没成时在页头写提示 */
export function HomeTrackMenu({
  opened,
  onClose,
}: {
  readonly opened: HomeTrackMenuState | null;
  onClose(): void;
}) {
  const home = useHomeServices();
  return (
    <OnlineTrackMenu
      menu={opened}
      onClose={onClose}
      onPlay={() => opened?.play()}
      onQueued={(ok) => {
        if (!ok) home.notify('online.queueFailed');
      }}
    />
  );
}
