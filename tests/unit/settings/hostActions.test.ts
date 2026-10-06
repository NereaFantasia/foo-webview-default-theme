import { describe, expect, it } from 'vitest';
import { copyText, openExternal, openPreferences } from '../../../src/settings/hostActions.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

function connect() {
  const host = installFakeHost({
    answers: {
      clipboard: { write: { success: true } },
      misc: { showPreferences: { success: true } },
      shell: { openExternal: { success: true } },
    },
  });
  return host;
}

describe('hostActions', () => {
  it('宿主照做了为真，参数原样带到', async () => {
    const host = connect();
    expect(await openPreferences(host.fb)).toBe(true);
    expect(await openExternal('https://example.org/', host.fb)).toBe(true);
    expect(await copyText('两行\n文字', host.fb)).toBe(true);
    expect(host.callsTo('misc.showPreferences')).toHaveLength(1);
    expect(host.callsTo('shell.openExternal')).toEqual([{ url: 'https://example.org/' }]);
    expect(host.callsTo('clipboard.write')).toEqual([{ text: '两行\n文字' }]);
  });

  it('失败信封与框架级错误都为假，不抛', async () => {
    const host = connect();
    host.answer('misc.showPreferences', hostFailure('OPERATION_FAILED'));
    host.answer('clipboard.write', () => {
      throw new Error('通道断了');
    });
    expect(await openPreferences(host.fb)).toBe(false);
    expect(await copyText('x', host.fb)).toBe(false);
  });

  it('没连上宿主时为假', async () => {
    const host = installFakeHost({ available: false });
    expect(await openExternal('https://example.org/', host.fb)).toBe(false);
  });
});
