import { atom, createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished } from 'vitest';
import {
  diagnosticsAtom,
  dismissedCountAtom,
  infoBannerAtom,
  infoMessagesAtom,
  startInfoCenter,
  type WindowEffectsFeedback,
} from '../../../src/host/infoCenter.ts';
import { diagnosticText } from '../../../src/host/hostInfo.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

it('窗口兼容性只有一条可恢复提醒，不进入阻断横幅，并附上诊断信息', async () => {
  const host = installFakeHost();
  const store = createStore();
  const notice = atom<'windows10' | 'unknown' | 'failed' | null>(null);
  const feedback: WindowEffectsFeedback = {
    notice,
    diagnostics: atom(
      'Window platform: windows10\nBackdrop: requested=mica, reported=none, effective=none',
    ),
  };
  const service = startInfoCenter(
    store,
    { playcountMissing: atom(false), libraryNotConfigured: atom(false) },
    host.fb,
    createMemoryConfigWriter(host.fb),
    undefined,
    undefined,
    undefined,
    feedback,
  );
  onTestFinished(() => service.dispose());
  await service.ready;
  expect(store.get(infoMessagesAtom)).toEqual([]);
  for (const reason of ['windows10', 'unknown', 'failed'] as const) {
    store.set(notice, reason);
    expect(store.get(infoMessagesAtom)).toEqual([
      { kind: 'windowEffectsLimited', level: 'reminder', params: { reason } },
    ]);
    expect(store.get(infoBannerAtom)).toEqual([]);
  }
  service.dismissReminder('windowEffectsLimited');
  expect(store.get(infoMessagesAtom)).toEqual([]);
  expect(store.get(dismissedCountAtom)).toBe(1);
  await service.persistence.settled();
  service.restoreReminders();
  expect(store.get(infoMessagesAtom)[0]?.kind).toBe('windowEffectsLimited');
  store.set(notice, null);
  expect(store.get(infoMessagesAtom)).toEqual([]);
  const diagnostics = store.get(diagnosticsAtom);
  expect(diagnostics && diagnosticText(diagnostics)).toContain(
    'requested=mica, reported=none, effective=none',
  );
});
