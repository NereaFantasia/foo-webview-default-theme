import { Provider } from 'jotai/react';
import { useMemo } from 'react';
import { CommandsContext } from './nav/useCommand.ts';
import { PlayingMark } from './track/PlayingMark.tsx';
import { trackKeyOf } from './playback/playbackContract.ts';
import { playingAudibleAtom, playingTrackKeyAtom } from './playback/playingTrack.ts';
import { TableContext } from './table/tableContext.ts';
import { AppToasts } from './shell/AppToasts.tsx';
import type { AppServices } from './app/services.ts';
import { MainWindow } from './shell/MainWindow.tsx';
import { ShellSlotsContext } from './shell/shellSlots.ts';
import { SHELL_SLOTS } from './app/shellSlots.ts';
import { ServicesContext, serviceMap } from './kit/useService.ts';
import { ThemeRoot } from './theme/ThemeRoot.tsx';
import { SearchRoot } from './library/search/SearchRoot.tsx';
import { BiographyRoot } from './app/BiographyRoot.tsx';
import { VideoRoot } from './app/VideoRoot.tsx';
import { TrackInfoRoot } from './app/TrackInfoRoot.tsx';
import { HomeRoot } from './app/HomeRoot.tsx';
import { UpdateRoot } from './app/UpdateRoot.tsx';
import { OnboardingDialog } from './settings/onboarding/OnboardingDialog.tsx';
import { WindowRoot } from './app/WindowRoot.tsx';
import { LyricsRoot } from './app/LyricsRoot.tsx';

export interface AppProps {
  services: AppServices;
}

/** 页面组装入口：接上 store、服务与主题，再挂主窗与全应用共用的轻提示；不放业务逻辑。 */
export function App({ services }: AppProps) {
  const table = useMemo(
    () => ({
      ratings: services.ratings,
      playingKey: playingTrackKeyAtom,
      audible: playingAudibleAtom,
      trackKey: trackKeyOf,
      PlayingMark,
    }),
    [services.ratings],
  );
  const serviceTable = useMemo(() => serviceMap(services.bindings), [services]);
  return (
    <Provider store={services.store}>
      <ServicesContext value={serviceTable}>
        <CommandsContext value={services.commands}>
          <TableContext value={table}>
            <ThemeRoot>
              <LyricsRoot services={services}>
                <TrackInfoRoot services={services}>
                  <BiographyRoot services={services}>
                    <SearchRoot>
                      <VideoRoot services={services}>
                        <HomeRoot services={services}>
                          <UpdateRoot>
                            <ShellSlotsContext value={SHELL_SLOTS}>
                              <WindowRoot>
                                <MainWindow />
                              </WindowRoot>
                            </ShellSlotsContext>
                            <AppToasts />
                            <OnboardingDialog />
                          </UpdateRoot>
                        </HomeRoot>
                      </VideoRoot>
                    </SearchRoot>
                  </BiographyRoot>
                </TrackInfoRoot>
              </LyricsRoot>
            </ThemeRoot>
          </TableContext>
        </CommandsContext>
      </ServicesContext>
    </Provider>
  );
}
