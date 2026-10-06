import { FakeHost, type FakeNative, type Listener } from './fakeHost.ts';
import { answerTrackInfo } from './trackInfoAnswers.ts';

export function installTrackInfoDemoHost() {
  if (Reflect.get(window, 'fb2k')) return;
  const host = new FakeHost();
  answerTrackInfo(host);
  const listeners = new Map<string, Set<Listener>>();
  const native: FakeNative = {
    invoke: (method, params) => host.invoke(method, params),
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(handler);
      return () => native.off(event, handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    once(event, handler) {
      const once: Listener = (data) => {
        native.off(event, once);
        handler(data);
      };
      return native.on(event, once);
    },
  };
  Object.defineProperty(window, 'fb2k', { value: native, configurable: true });
}
