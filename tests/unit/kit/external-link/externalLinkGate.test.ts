import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  EXTERNAL_LINK_CONFIRM,
  externalHttpUrl,
  startExternalLinkGate,
} from '../../../../src/kit/external-link/externalLinkGate.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

describe('外部链接确认', () => {
  it('确认之前不打开浏览器，取消也不写偏好；勾选后下一次直接打开', async () => {
    const host = installFakeHost();
    host.answer('shell.openExternal', { success: true });
    const store = createStore();
    const gate = startExternalLinkGate(store, host.fb, createMemoryConfigWriter(host.fb));
    await gate.ready;
    gate.open('https://example.com/a');
    expect(store.get(gate.prompt)).toMatchObject({ url: 'https://example.com/a', busy: false });
    expect(host.callsTo('shell.openExternal')).toEqual([]);
    gate.cancel();
    expect(store.get(gate.prompt)).toBeNull();
    expect(store.get(EXTERNAL_LINK_CONFIRM.atom)).toBe(true);
    gate.open('https://example.com/a');
    gate.confirm(true);
    await vi.waitFor(() => expect(store.get(gate.prompt)).toBeNull());
    expect(store.get(EXTERNAL_LINK_CONFIRM.atom)).toBe(false);
    await vi.waitFor(() => expect(host.config.get(EXTERNAL_LINK_CONFIRM.key)).toBe(false));
    gate.open('https://example.com/b');
    expect(store.get(gate.prompt)).toBeNull();
    await vi.waitFor(() =>
      expect(host.callsTo('shell.openExternal').at(-1)).toEqual({ url: 'https://example.com/b' }),
    );
    gate.dispose();
  });

  it('打开失败时允许重试，不记住跳过确认；释放后丢弃在途结果', async () => {
    const host = installFakeHost();
    host.answer('shell.openExternal', hostFailure('OPERATION_FAILED'));
    const store = createStore();
    const gate = startExternalLinkGate(store, host.fb, createMemoryConfigWriter(host.fb));
    await gate.ready;
    gate.open('https://example.com/');
    gate.confirm(true);
    await vi.waitFor(() =>
      expect(store.get(gate.prompt)).toMatchObject({ failed: true, busy: false }),
    );
    expect(store.get(EXTERNAL_LINK_CONFIRM.atom)).toBe(true);
    const held = host.hold('shell.openExternal');
    gate.confirm(true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    gate.dispose();
    held.respond(0, { success: true });
    await Promise.resolve();
    expect(store.get(EXTERNAL_LINK_CONFIRM.atom)).toBe(true);
  });

  it('只接受 HTTP(S)，拒绝可执行方案和带凭据的网址', () => {
    for (const value of [
      'javascript:alert(1)',
      'file:///C:/secret',
      'data:text/html,x',
      'https://user:secret@example.com',
    ])
      expect(externalHttpUrl(value)).toBeNull();
    expect(externalHttpUrl('/artist', 'https://example.com/wiki')).toBe(
      'https://example.com/artist',
    );
  });
});
