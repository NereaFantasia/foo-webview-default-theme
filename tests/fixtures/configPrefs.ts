import { fb } from 'foo-webview-sdk/bridge';
import { createStore } from 'jotai/vanilla';
import { defineConfigPref, startConfigPrefs } from '../../src/host/configPref.ts';
import { createConfigWriter } from '../../src/host/configWrite.ts';
import { startBrowserDataWriter } from '../../src/kit/browserDataStorage.ts';

/** 经 Vite 解析 SDK 与 Jotai，浏览器用例使用与应用相同的模块实例。 */
export async function createConfigPrefsProbe() {
  const data = startBrowserDataWriter();
  const store = createStore();
  const pref = defineConfigPref('defaultTheme.test.preference', 'default', (raw) =>
    typeof raw === 'string' ? raw : undefined,
  );
  const prefs = startConfigPrefs(store, [pref], fb, createConfigWriter(fb, data));
  await prefs.ready;
  return {
    set: (value: string) => prefs.set(pref, value),
    value: () => store.get(pref.atom),
    state: () => store.get(prefs.state).get(pref.key),
    retry: () => prefs.retry(pref.key),
    dispose() {
      prefs.dispose();
      data.dispose();
    },
  };
}
