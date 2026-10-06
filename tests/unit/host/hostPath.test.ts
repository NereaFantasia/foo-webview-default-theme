import { describe, expect, it } from 'vitest';
import { normalizeHostPath, relativeBaseOf } from '../../../src/host/hostPath.ts';

describe('relativeBaseOf', () => {
  it('取 profile 的父目录，尾部分隔符与斜杠方向不影响', () => {
    expect(relativeBaseOf('E:\\FB2K\\foobar2000\\profile')).toBe('E:\\FB2K\\foobar2000');
    expect(relativeBaseOf('E:/FB2K/foobar2000/profile/')).toBe('E:\\FB2K\\foobar2000');
  });

  it('父目录只剩盘符时补回根分隔符；没有上一级时为 null', () => {
    expect(relativeBaseOf('P:\\profile')).toBe('P:\\');
    expect(relativeBaseOf('profile')).toBeNull();
  });
});

describe('normalizeHostPath', () => {
  it('去掉 file:// 与 subsong 后缀、分隔符统一、折小写', () => {
    expect(normalizeHostPath('file://E:/Music/Album/01.FLAC|subsong:2')).toBe(
      'e:\\music\\album\\01.flac',
    );
    expect(normalizeHostPath('E:\\Music\\a.flac')).toBe('e:\\music\\a.flac');
    expect(normalizeHostPath('')).toBe('');
  });

  it('便携安装的相对路径拼到基准上并折掉 ..，越过根的停在根上', () => {
    const base = 'E:\\FB2K\\foobar2000';
    expect(normalizeHostPath('file-relative://..\\Music\\a.flac', base)).toBe(
      'e:\\fb2k\\music\\a.flac',
    );
    expect(normalizeHostPath('file-relative://..\\..\\..\\..\\x.flac', base)).toBe('e:\\x.flac');
    expect(normalizeHostPath('file-relative://.\\Music\\a.flac', base)).toBe(
      'e:\\fb2k\\foobar2000\\music\\a.flac',
    );
  });

  it('没给基准时只去掉前缀；相对部分已是绝对路径时不拼', () => {
    expect(normalizeHostPath('file-relative://..\\Music\\a.flac')).toBe('..\\music\\a.flac');
    expect(normalizeHostPath('file-relative://D:\\a.flac', 'E:\\x')).toBe('d:\\a.flac');
  });

  it('UNC 基准的服务器名与共享名不参与折叠', () => {
    expect(normalizeHostPath('file-relative://..\\..\\..\\a.flac', '\\\\nas\\share\\fb2k')).toBe(
      '\\\\nas\\share\\a.flac',
    );
  });
});
