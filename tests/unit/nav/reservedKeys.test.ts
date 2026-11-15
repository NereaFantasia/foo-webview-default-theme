import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startCommandRegistry, type KeyChord } from '../../../src/nav/commandRegistry.ts';
import { captureAllKeys, reservedKeyOf, startReservedKeys } from '../../../src/nav/reservedKeys.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

// 宿主 2.2.0 起，页面有焦点时，foobar2000 里绑定过的键会先于页面执行。主题登记过的键要告知宿主留给页面

function command(id: string, ...keys: KeyChord[]) {
  return { id, layer: 'global', keys, run: () => {} } as const;
}

function setup() {
  const host = installFakeHost();
  const store = createStore();
  const commands = startCommandRegistry(null);
  const stop = startReservedKeys(store, commands, host.fb);
  onTestFinished(stop);
  const reserved = () => host.callsTo('keyboard.setReservedKeys');
  /** 供没有后续调用的断言使用：让已排队的微任务与零延迟定时器都执行完 */
  const idle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { host, store, commands, reserved, idle };
}

describe('reservedKeyOf', () => {
  it('按键写成宿主认可的键串：修饰键在前，方向键、空格、Esc 换成宿主的名称', () => {
    expect(reservedKeyOf({ key: 'f', ctrl: true })).toBe('Ctrl+F');
    expect(reservedKeyOf({ key: 'P', ctrl: true, shift: true })).toBe('Ctrl+Shift+P');
    expect(reservedKeyOf({ key: 'ArrowLeft', alt: true })).toBe('Alt+Left');
    expect(reservedKeyOf({ key: ' ' })).toBe('Space');
    expect(reservedKeyOf({ key: 'Escape' })).toBe('Esc');
    expect(reservedKeyOf({ key: 'F10' })).toBe('F10');
    expect(reservedKeyOf({ key: '=', ctrl: true, meta: true })).toBe('Ctrl+Win+=');
  });

  it('宿主没有的键名返回 null，避免一个无效键使整次调用失败', () => {
    expect(reservedKeyOf({ key: '+', ctrl: true })).toBeNull();
    expect(reservedKeyOf({ key: 'F13' })).toBeNull();
    expect(reservedKeyOf({ key: 'Unidentified' })).toBeNull();
  });
});

describe('startReservedKeys', () => {
  it('登记的按键去重排序后告知宿主，无法识别的键名跳过', async () => {
    const env = setup();
    env.commands.register(
      command('search', { key: 'f', ctrl: true }, { key: 'ArrowLeft', alt: true }),
    );
    env.commands.register(command('find', { key: 'f', ctrl: true }, { key: '+', ctrl: true }));
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(1));
    expect(env.reserved()[0]).toEqual({ keys: ['Alt+Left', 'Ctrl+F'] });
  });

  it('命令登记或注销后整份替换，没有任何命令时发送空表', async () => {
    const env = setup();
    const offSearch = env.commands.register(command('search', { key: 'f', ctrl: true }));
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(1));
    const offBrowse = env.commands.register(command('browse', { key: 'b', ctrl: true }));
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(2));
    expect(env.reserved()[1]).toEqual({ keys: ['Ctrl+B', 'Ctrl+F'] });
    offSearch();
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(3));
    expect(env.reserved()[2]).toEqual({ keys: ['Ctrl+B'] });
    offBrowse();
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(4));
    expect(env.reserved()[3]).toEqual({ keys: [] });
  });

  it('按键没有变化就不再发送：同一个 id 重新登记、只有鼠标键的命令都不算变化', async () => {
    const env = setup();
    env.commands.register(command('search', { key: 'f', ctrl: true }));
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(1));
    env.commands.register(command('search', { key: 'f', ctrl: true }));
    env.commands.register({ id: 'back', layer: 'global', buttons: [3], run: () => {} });
    await env.idle();
    expect(env.reserved()).toHaveLength(1);
  });

  it('录键期间全部按键交给页面，结束后恢复为登记的那一份', async () => {
    const env = setup();
    env.commands.register(command('search', { key: 'f', ctrl: true }));
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(1));
    const release = captureAllKeys(env.store);
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(2));
    expect(env.reserved()[1]).toEqual({ keys: ['Ctrl+F'], all: true });
    release();
    release();
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(3));
    expect(env.reserved()[2]).toEqual({ keys: ['Ctrl+F'] });
  });

  it('两处同时录键时，最后一处结束后才恢复', async () => {
    const env = setup();
    const first = captureAllKeys(env.store);
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(1));
    const second = captureAllKeys(env.store);
    first();
    await env.idle();
    expect(env.reserved()).toHaveLength(1);
    second();
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(2));
    expect(env.reserved()[1]).toEqual({ keys: [] });
  });

  it('宿主拒绝时不重试，等下一次变化再发送', async () => {
    const env = setup();
    env.host.answerAll({ keyboard: { setReservedKeys: hostFailure('INVALID_PARAMS') } });
    env.commands.register(command('search', { key: 'f', ctrl: true }));
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(1));
    await env.idle();
    expect(env.reserved()).toHaveLength(1);
    env.commands.register(command('browse', { key: 'b', ctrl: true }));
    await vi.waitFor(() => expect(env.reserved()).toHaveLength(2));
  });

  it('停止之后不再发送', async () => {
    const host = installFakeHost();
    const commands = startCommandRegistry(null);
    const stop = startReservedKeys(createStore(), commands, host.fb);
    stop();
    commands.register(command('search', { key: 'f', ctrl: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(host.callsTo('keyboard.setReservedKeys')).toEqual([]);
  });
});
