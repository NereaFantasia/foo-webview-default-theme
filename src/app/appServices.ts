import { startServices, type AppServices } from './services.ts';
import { startColorIntegration } from './colorIntegration.ts';
import { startBaseAccent } from '../theme/baseAccent.ts';
import { loadPlayButtonStyle } from '../theme/playButtonStyle.ts';
import { loadWindowBackground } from '../theme/background/windowBackground.ts';
import { loadSurfaceTint } from '../theme/surfaceTint.ts';
import { startBackgroundImage } from '../theme/background/backgroundImage.ts';
import { startBrowserDataWriter } from '../kit/browserDataStorage.ts';
import { installPrefStorage } from '../kit/localPref.ts';
import { openBrowserPrefStorage } from '../kit/prefStorage.ts';
import { bindService } from '../kit/serviceKey.ts';
import { lyricsIntegrationKey, startLyricsIntegration } from './lyricsIntegration.ts';
import { startFlowingBackground } from './flowingBackground.ts';
import { flowingFieldKey } from '../theme/background/flowingField.ts';
import { atom } from 'jotai/vanilla';
import { windowShellAtom } from '../host/windowShell.ts';
import { translateAtom } from '../i18n/locale.ts';
import { desktopLyricsKey, startDesktopLyrics } from '../lyrics/desktop/desktopLyrics.ts';
import { currentTrackAtom } from '../playback/playback.ts';
import { accentRampAtom } from '../theme/accentState.ts';
import { migrateColumnPreferences } from '../table/columns/columnMigration.ts';

/**
 * 先读完浏览器偏好的可信副本、装上页面的偏好存储，再建服务：各服务同步读到的就是可信值
 * 颜色存档在渲染前同步恢复，播放订阅与应用服务一起释放
 */
export async function startAppServices(): Promise<AppServices> {
  const dataWriter = startBrowserDataWriter();
  const migration = await migrateColumnPreferences(dataWriter);
  const prefs = await openBrowserPrefStorage(
    migration.success
      ? dataWriter
      : {
          run: dataWriter.run,
          readAll: async () => migration,
        },
  );
  installPrefStorage(prefs);
  const services = startServices(dataWriter, prefs);
  loadPlayButtonStyle(services.store);
  loadWindowBackground(services.store);
  loadSurfaceTint(services.store);
  const backgroundImage = startBackgroundImage(services.store);
  const baseAccent = startBaseAccent(services.store);
  const colors = startColorIntegration(services.store, { artwork: services.artwork });
  const flowing = startFlowingBackground(services.store);
  const lyrics = startLyricsIntegration(services);
  // ponytail: 沉浸视图开着就当它在显示歌词；有的场景没有歌词，要分场景时改看沉浸视图的歌词部件
  const desktopLyrics = startDesktopLyrics(services.store, {
    lyrics: { ...lyrics.service, seek: lyrics.seek },
    track: currentTrackAtom,
    ramp: accentRampAtom,
    shown: atom(
      (get) => get(windowShellAtom).active && (get(lyrics.active) || get(lyrics.immersiveActive)),
    ),
    translate: translateAtom,
    writer: services.configWriter,
  });
  return {
    ...services,
    bindings: [
      ...services.bindings,
      bindService(lyricsIntegrationKey, lyrics),
      bindService(desktopLyricsKey, desktopLyrics),
      bindService(flowingFieldKey, flowing),
    ],
    dispose() {
      flowing.dispose();
      desktopLyrics.dispose();
      lyrics.dispose();
      backgroundImage.dispose();
      colors.dispose();
      baseAccent.dispose();
      services.dispose();
      installPrefStorage(null);
    },
  };
}
