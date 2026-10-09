import { startServices, type AppServices } from './services.ts';
import { startColorIntegration } from './colorIntegration.ts';
import { startBaseAccent } from '../theme/baseAccent.ts';
import { loadPlayButtonStyle } from '../theme/playButtonStyle.ts';
import { loadWindowBackground } from '../theme/background/windowBackground.ts';
import { startBackgroundImage } from '../theme/background/backgroundImage.ts';
import { startBrowserDataWriter } from '../kit/browserDataStorage.ts';
import { installPrefStorage } from '../kit/localPref.ts';
import { openBrowserPrefStorage } from '../kit/prefStorage.ts';
import { bindService } from '../kit/serviceKey.ts';
import { lyricsIntegrationKey, startLyricsIntegration } from './lyricsIntegration.ts';
import { startFlowingBackground } from './flowingBackground.ts';
import { flowingFieldKey } from '../theme/background/flowingField.ts';

/**
 * 先读完浏览器偏好的可信副本、装上页面的偏好存储，再建服务：各服务同步读到的就是可信值。
 * 颜色存档在渲染前同步恢复，播放订阅与应用服务一起释放。
 */
export async function startAppServices(): Promise<AppServices> {
  const dataWriter = startBrowserDataWriter();
  const prefs = await openBrowserPrefStorage(dataWriter);
  installPrefStorage(prefs);
  const services = startServices(dataWriter, prefs);
  loadPlayButtonStyle(services.store);
  loadWindowBackground(services.store);
  const backgroundImage = startBackgroundImage(services.store);
  const baseAccent = startBaseAccent(services.store);
  const colors = startColorIntegration(services.store);
  const flowing = startFlowingBackground(services.store);
  const lyrics = startLyricsIntegration(services);
  return {
    ...services,
    bindings: [
      ...services.bindings,
      bindService(lyricsIntegrationKey, lyrics),
      bindService(flowingFieldKey, flowing),
    ],
    dispose() {
      flowing.dispose();
      lyrics.dispose();
      backgroundImage.dispose();
      colors.dispose();
      baseAccent.dispose();
      services.dispose();
      installPrefStorage(null);
    },
  };
}
