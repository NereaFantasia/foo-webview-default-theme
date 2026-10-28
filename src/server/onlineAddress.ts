import {
  MUSIC_PLATFORMS,
  MUSIC_QUALITIES,
  type MusicQuality,
  type MusicRef,
} from './musicObjects.ts';

/**
 * 在线曲目交给 fb2k 的占位地址，指向本地后端的音频路由，打开时后端才去取真实地址。曲目身份只看路径里的
 * 平台与 ID，与端口、音质无关；端口随后端启动变化，旧端口的地址要改写才能再打开
 */
export interface OnlineAddress {
  readonly port: number;
  readonly ref: MusicRef;
  readonly quality: MusicQuality;
}

// 与后端音频路由收的路径同一规则；ID 不在这个字符集里的曲目没有占位地址
const PATH = /^\/music\/stream\/([a-z]{2})\/([A-Za-z0-9_-]{1,64})\.(mp3|flac)$/;
const HOST = '127.0.0.1';

/** 扩展名按请求的档位取，实际格式由 fb2k 按内容识别。ID 不能放进地址时答 null */
export function onlineAddress(port: number, ref: MusicRef, quality: MusicQuality): string | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ref.id)) return null;
  const extension = quality === 'flac' || quality === 'flac24bit' ? 'flac' : 'mp3';
  return `http://${HOST}:${port}/music/stream/${ref.platform}/${ref.id}.${extension}?q=${quality}`;
}

/** 不是占位地址（本地文件、电台、别的网址）时答 null */
export function readOnlineAddress(path: string): OnlineAddress | null {
  if (!path.startsWith(`http://${HOST}:`)) return null;
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return null;
  }
  const match = PATH.exec(url.pathname);
  const platform = MUSIC_PLATFORMS.find((item) => item === match?.[1]);
  const quality = MUSIC_QUALITIES.find((item) => item === url.searchParams.get('q'));
  const port = Number(url.port);
  if (
    !match?.[2] ||
    !platform ||
    !quality ||
    url.hostname !== HOST ||
    !Number.isInteger(port) ||
    port <= 0 ||
    [...url.searchParams.keys()].length !== 1 ||
    url.hash ||
    url.username
  )
    return null;
  return { port, ref: { platform, id: match[2] }, quality };
}
