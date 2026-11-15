import { readOnlineAddress } from './onlineAddress.ts';

/**
 * 通知本地后端：这首在线曲目要做整轨分析，请把整首下进内存，之后宿主对同一个地址的几次读取共用这一份，
 * 不各自向上游下载。地址不能换：宿主只对原地址缓存了技术信息，换了地址解码接口答 `NO_INFO`
 *
 * HEAD 请求立刻应答，下载在后端后台进行，重复通知无害。通知不到（后端旧、已退出）只是退回逐次下载，
 * 不当失败；不是在线曲目的占位地址时什么也不做
 */
export type HoldTrack = (path: string, signal?: AbortSignal) => Promise<void>;

export const holdOnlineTrack: HoldTrack = async (path, signal) => {
  if (!readOnlineAddress(path)) return;
  try {
    await fetch(`${path}&hold=1`, { method: 'HEAD', mode: 'no-cors', signal });
  } catch {
    // 退回逐次下载
  }
};
