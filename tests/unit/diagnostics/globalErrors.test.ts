import { beforeEach, describe, expect, it } from 'vitest';
import { entries, resetEventLog } from '../../../src/diagnostics/eventLog.ts';
import { installGlobalErrors, recordError } from '../../../src/diagnostics/globalErrors.ts';

beforeEach(() => {
  resetEventLog();
});

function failure(message: string, stack: string, name = 'TypeError'): Error {
  const error = new Error(message);
  error.name = name;
  error.stack = stack;
  return error;
}

describe('记录错误', () => {
  it('只留名称、消息与栈里第一处脚本的路径和行列', () => {
    recordError(
      'uncaught',
      failure(
        'x is not a function',
        'TypeError: x is not a function\n    at f (https://theme.local/assets/index-3f9a.js?v=1:1:88213)\n    at g (https://theme.local/assets/other.js:2:3)',
      ),
    );
    expect(entries()).toEqual([
      {
        t: expect.any(Number),
        level: 'error',
        tag: 'error',
        event: 'uncaught',
        fields: {
          name: 'TypeError',
          message: 'x is not a function',
          file: 'assets/index-3f9a.js',
          line: 1,
          col: 88213,
        },
      },
    ]);
  });

  it('消息里引号内的内容换成省略号，不带出数据片段', () => {
    recordError(
      'start',
      failure(
        `Unexpected token '<', "<html>《晴天》</html>" is not valid JSON`,
        'SyntaxError: x',
        'SyntaxError',
      ),
    );
    const fields = entries()[0]?.fields;
    expect(fields?.['message']).toBe(`Unexpected token '…', "…" is not valid JSON`);
    expect(JSON.stringify(entries())).not.toContain('晴天');
  });

  it('消息里的路径经日志入口脱敏', () => {
    recordError('start', failure('EPERM rename C:\\Users\\张三\\a.dll', 'Error: x'));
    expect(entries()[0]?.fields?.['message']).toBe('EPERM rename <path>');
  });

  it('不是 Error 的值只记类型与文字', () => {
    recordError('unhandledrejection', 'plain text');
    recordError('unhandledrejection', undefined);
    expect(entries().map((entry) => entry.fields)).toEqual([
      { name: 'string', message: 'plain text' },
      { name: 'undefined', message: 'undefined' },
    ]);
  });

  it('栈里没有脚本位置时不写 file、line、col', () => {
    recordError('uncaught', failure('boom', 'Error: boom\n    at <anonymous>'));
    expect(entries()[0]?.fields).toEqual({ name: 'TypeError', message: 'boom' });
  });
});

describe('全局监听', () => {
  it('error 与 unhandledrejection 都记下来，卸载后不再记', () => {
    const target = new EventTarget();
    const uninstall = installGlobalErrors(target);
    target.dispatchEvent(
      Object.assign(new Event('error'), { error: failure('bad', 'Error: bad'), message: 'bad' }),
    );
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'nope' }));
    expect(entries().map((entry) => entry.event)).toEqual(['uncaught', 'unhandledrejection']);
    uninstall();
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('late') }));
    expect(entries()).toHaveLength(2);
  });

  it('没有 error 对象的脚本错误回退到事件自带的 message', () => {
    const target = new EventTarget();
    installGlobalErrors(target);
    target.dispatchEvent(
      Object.assign(new Event('error'), { error: null, message: 'Script error.' }),
    );
    expect(entries()[0]?.fields).toEqual({ name: 'string', message: 'Script error.' });
  });

  it('浏览器的 ResizeObserver 布局提示不记，同样没有 error 对象的其他消息照记', () => {
    const target = new EventTarget();
    installGlobalErrors(target);
    for (const message of [
      'ResizeObserver loop completed with undelivered notifications.',
      'ResizeObserver loop limit exceeded',
    ])
      target.dispatchEvent(Object.assign(new Event('error'), { error: null, message }));
    expect(entries()).toHaveLength(0);
    target.dispatchEvent(Object.assign(new Event('error'), { error: null, message: 'boom' }));
    expect(entries()).toHaveLength(1);
  });
});
