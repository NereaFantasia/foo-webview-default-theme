import { describe, expect, it } from 'vitest';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import type { MusicLxHealth, MusicLxSource } from '../../../src/server/musicLxSources.ts';
import {
  checkable,
  healthLabel,
  healthState,
  healthTip,
  lastCheckedAt,
  relativeTime,
} from '../../../src/settings/lxHealthText.ts';

const t = createTranslate(zhCN, {});
const locale = 'zh-CN';
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const ago = (seconds: number) => NOW - seconds * 1000;
const health = (patch: Partial<MusicLxHealth>): MusicLxHealth => ({
  status: 'ok',
  reason: null,
  message: null,
  ms: 215,
  at: ago(5),
  ...patch,
});
const FAILED = health({ status: 'failed', reason: 'unreachable', message: 'HTTP 404' });

describe('音源检测结果的文字', () => {
  it('平台项的状态：正在检测的优先，没检测过的是 none', () => {
    expect(healthState(undefined, false)).toBe('none');
    expect(healthState(FAILED, false)).toBe('failed');
    expect(healthState(health({}), false)).toBe('ok');
    expect(healthState(health({ status: 'unknown', reason: 'no-sample' }), false)).toBe('unknown');
    expect(healthState(FAILED, true)).toBe('checking');
  });

  it('无障碍名是「平台：结果」，各种失败写各自的话', () => {
    const label = (value: MusicLxHealth | undefined, checking = false) =>
      healthLabel(t, '酷我', value, checking);
    expect(label(undefined)).toBe('酷我：未检测');
    expect(label(health({}))).toBe('酷我：可用');
    expect(label(health({ status: 'failed', reason: 'script' }))).toBe('酷我：没有给出播放地址');
    expect(label(FAILED)).toBe('酷我：地址打不开');
    expect(label(health({ status: 'failed', reason: 'timeout' }))).toBe('酷我：没有回应');
    expect(label(health({ status: 'unknown', reason: 'no-sample' }))).toBe('酷我：没能检测');
    expect(label(FAILED, true)).toBe('酷我：检测中');
  });

  it('时间：一分钟内写刚刚，一小时内写分钟，一天内写小时，再久写日期', () => {
    const when = (seconds: number) => relativeTime(t, locale, ago(seconds), NOW);
    expect(when(0)).toBe('刚刚');
    expect(when(44)).toBe('刚刚');
    expect(when(300)).toBe(
      new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-5, 'minute'),
    );
    expect(when(3 * 3600)).toBe(
      new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-3, 'hour'),
    );
    expect(when(2 * 86_400)).toBe(
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(ago(2 * 86_400)),
    );
  });

  it('悬浮提示：结果、第三方的说明、多久以前，没有说明就省掉那一段；没检测过没有提示', () => {
    const tip = (value: MusicLxHealth | undefined) => healthTip(t, locale, value, NOW);
    expect(tip(undefined)).toBeNull();
    expect(tip(health({}))).toBe('可用 · 215 毫秒 · 刚刚');
    expect(tip(FAILED)).toBe('地址打不开 · HTTP 404 · 刚刚');
    expect(tip(health({ status: 'failed', reason: 'script', message: null }))).toBe(
      '没有给出播放地址 · 刚刚',
    );
    expect(tip(health({ status: 'failed', reason: 'script', message: '咪咕找不到' }))).toBe(
      '没有给出播放地址 · 咪咕找不到 · 刚刚',
    );
    expect(tip(health({ status: 'failed', reason: 'timeout' }))).toBe('15 秒内没有回应 · 刚刚');
    expect(tip(health({ status: 'unknown', reason: 'no-sample' }))).toBe('没有可检测的曲目');
  });

  it('上次检测时间：取音源各平台里最晚的一次，没能检测的也算，都没检测过是 null', () => {
    expect(lastCheckedAt({}, ['kw', 'kg'])).toBeNull();
    const recorded = {
      kw: health({ at: ago(600) }),
      kg: health({ status: 'unknown', reason: 'no-sample', at: ago(120) }),
      mg: health({ at: ago(1) }),
    };
    expect(lastCheckedAt(recorded, ['kw', 'kg'])).toBe(ago(120));
    expect(lastCheckedAt(recorded, ['kw', 'kg', 'mg'])).toBe(ago(1));
    expect(lastCheckedAt(recorded, ['tx'])).toBeNull();
  });

  it('只检测启用着、脚本也载入了的音源', () => {
    const source: MusicLxSource = {
      id: 'a.js',
      name: 'A',
      version: null,
      author: null,
      description: null,
      platforms: ['kw'],
      enabled: true,
      failed: false,
      error: null,
      health: {},
    };
    expect(checkable(source)).toBe(true);
    expect(checkable({ ...source, enabled: false })).toBe(false);
    expect(checkable({ ...source, failed: true })).toBe(false);
  });
});
