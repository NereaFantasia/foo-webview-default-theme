import { readOnlineAddress } from '../server/onlineAddress.ts';

/** 协议前缀至少两个字符，`E:\` 这样的盘符不算协议 */
const SCHEME = /^([a-z][a-z0-9+.-]+):/i;

/**
 * 曲目来源类型（根据路径协议头区分）：
 * - `file`: 本地普通文件（含便携安装相对路径、绝对盘符与 UNC 共享路径）
 * - `container`: 压缩包归档内音频或 CDDA 光盘音轨
 * - `online`: 在线曲目（本地后端分发的占位虚拟地址）
 * - `stream`: 外部流媒体网络流（HTTP 网络电台、MMS 等自定义流协议）
 */
export type TrackOrigin = 'file' | 'container' | 'online' | 'stream';

export function trackOrigin(path: string): TrackOrigin {
  const scheme = SCHEME.exec(path)?.[1]?.toLowerCase();
  if (!scheme || scheme === 'file' || scheme === 'file-relative') return 'file';
  if (scheme === 'unpack' || scheme === 'cdda') return 'container';
  return readOnlineAddress(path) ? 'online' : 'stream';
}

/**
 * 各曲目来源的能力集约束表
 * 界面根据来源类型查询该契约表以进行行为分流，禁止在组件层散落针对来源协议的硬编码判定
 */
export interface TrackAbilities {
  /**
   * 宿主是否支持同步读取本地元数据（标签读取、字段求值、内嵌歌词提取与封面枚举等）
   * 网络流该项为 false，避免阻塞 fb2k 主线程长达 10 秒超时
   */
  readonly opensLocally: boolean;
  /** 是否支持交由宿主执行原生右键菜单上下文命令（属性编辑、格式转换、ReplayGain 扫描等） */
  readonly hostCommands: boolean;
  /** 是否支持媒体库操作联动（如添加至播放列表、跳转至媒体库同名专辑/艺人） */
  readonly libraryActions: boolean;
  /** 封面是否委托宿主检索（网络流与在线曲目直接使用外部 URL，宿主无法解析其本地封面） */
  readonly hostArtwork: boolean;
  /** 属性详情面板是否展示本地文件绝对路径、播放统计与 ReplayGain 信息 */
  readonly fileDetails: boolean;
}

const LOCAL: TrackAbilities = {
  opensLocally: true,
  hostCommands: true,
  libraryActions: true,
  hostArtwork: true,
  fileDetails: true,
};

const ABILITIES: Readonly<Record<TrackOrigin, TrackAbilities>> = {
  file: LOCAL,
  container: LOCAL,
  stream: { ...LOCAL, opensLocally: false },
  online: {
    opensLocally: false,
    hostCommands: false,
    libraryActions: false,
    hostArtwork: false,
    fileDetails: false,
  },
};

export function trackAbilities(path: string): TrackAbilities {
  return ABILITIES[trackOrigin(path)];
}

/** 一批曲目共有的能力：任一首不能，整批就不能。空批按本地文件算 */
export function batchAbilities(paths: readonly string[]): TrackAbilities {
  const each = paths.map(trackAbilities);
  const all = (key: keyof TrackAbilities) => each.every((abilities) => abilities[key]);
  return {
    opensLocally: all('opensLocally'),
    hostCommands: all('hostCommands'),
    libraryActions: all('libraryActions'),
    hostArtwork: all('hostArtwork'),
    fileDetails: all('fileDetails'),
  };
}
