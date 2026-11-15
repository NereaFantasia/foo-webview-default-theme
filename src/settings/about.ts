import metadata from '../../package.json' with { type: 'json' };
import { reportText } from '../diagnostics/eventLog.ts';
import { diagnosticText, type Diagnostics } from '../host/hostInfo.ts';
import type { MusicStatus, MusicStreamFailure } from '../server/musicProtocol.ts';

/** 主题自己的版本号，与 package.json 的 `version` 是同一个数 */
export const THEME_VERSION = metadata.version;

/** 许可全文的网址：主题以 AGPL-3.0-only 发布 */
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/**
 * 「复制」放进剪贴板的文字：第一行是主题的版本，后面是 foobar2000 与组件的诊断信息。不随界面语言变：
 * 贴进问题报告里给维护者看，一种写法好认
 */
export function versionReport(diagnostics: Diagnostics): string {
  return [`foo-webview-default-theme ${THEME_VERSION}`, diagnosticText(diagnostics)].join('\n');
}

/** 复制那一刻窗口与界面的现状：高分屏、缩放、深浅这类版式问题要靠它对上 */
export interface WindowSnapshot {
  readonly width: number;
  readonly height: number;
  /** 设备像素比，可能带浮点误差 */
  readonly ratio: number;
  readonly scheme: string;
  readonly locale: string;
  readonly userAgent: string;
}

/** 运行日志头里的一行现状；浏览器标识里认得出 WebView2 的 Edge 内核时带上它的主版本 */
export function windowStateText(snapshot: WindowSnapshot): string {
  const { width, height, ratio, scheme, locale, userAgent } = snapshot;
  const edge = /Edg\/(\d+)/.exec(userAgent)?.[1];
  return `[state] viewport=${width}x${height}@${Math.round(ratio * 100) / 100} scheme=${scheme} locale=${locale}${edge ? ` runtime=Edge ${edge}` : ''}`;
}

/**
 * 「复制运行日志」放进剪贴板的文字：版本信息、可选的现状行，再加内存里的日志。还没读到宿主版本时
 * （启动失败页）头里只有主题版本与浏览器标识
 */
export function runtimeLogReport(diagnostics: Diagnostics | null, state?: string): string {
  const head = diagnostics
    ? versionReport(diagnostics)
    : `foo-webview-default-theme ${THEME_VERSION}\nuser agent: ${navigator.userAgent}`;
  return reportText(state ? `${head}\n${state}` : head);
}

/** 关于页「在线音乐服务」此刻读到的状态 */
export interface MusicServiceSnapshot {
  /** 已连上的后端端口；没连上时为 null */
  readonly port: number | null;
  /** 后端最近一次答的健康检查；还没答过时为 null */
  readonly health: { readonly version: string; readonly runtime: string } | null;
  /** 后端的在线音乐状态；还没读到时为 null */
  readonly music: MusicStatus | null;
  /** 网易云组件登记的版本；问不到或开发时没有登记时为 null */
  readonly ncmVersion: string | null;
  /** 页面载入以来最后一次播放失败 */
  readonly lastFailure: MusicStreamFailure | null;
}

/**
 * 「在线音乐服务」的「复制」放进剪贴板的文字，同版本卡不随界面语言变。不含令牌、Cookie、网易云昵称与
 * lxserver 的地址：问题报告可能贴在公开的地方
 */
export function musicServiceReport(snapshot: MusicServiceSnapshot): string {
  const { port, health, music, ncmVersion, lastFailure } = snapshot;
  const lines = [
    port === null
      ? 'backend: not connected'
      : `backend: connected 127.0.0.1:${port}${health ? `, ${health.version}, Node ${health.runtime}` : ''}`,
  ];
  if (music) {
    const component = ncmVersion ? `${music.ncm} ${ncmVersion}` : music.ncm;
    const account = music.account ? 'signed in' : 'signed out';
    lines.push(`netease: ${component}, ${account}, unblock ${music.unblock ? 'on' : 'off'}`);
    if (music.lx !== 'unconfigured') {
      const platforms = music.platforms.filter((platform) => platform !== 'wy');
      lines.push(`lxserver: ${music.lx}, platforms ${platforms.join(' ') || 'none'}`);
    }
  }
  if (lastFailure) {
    const { ref, code, at } = lastFailure;
    lines.push(`last failure: ${ref.platform}:${ref.id} ${code} ${new Date(at).toISOString()}`);
  }
  return lines.join('\n');
}
