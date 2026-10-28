import type { AlbumKey } from '../host/libraryContract.ts';
import {
  isPlainGenre,
  onlineAlbumsSubject,
  onlineListSubject,
  readOnlineAlbumsSubject,
  readOnlineListSubject,
  type OnlineAlbumsSubject,
  type OnlineListSubject,
  type Place,
} from './places.ts';

/**
 * 跨模块可跳转领域实体的联合引用模型
 * 视图间仅传递引用，具体路由与打开行为由对象打开服务接管；联合类型受穷尽性检查约束，新增种类时 placeOf 与 refOf 必须补齐分支
 */
export type ObjectRef =
  | { readonly kind: 'album'; readonly key: AlbumKey }
  /** 艺人名称作为唯一标识：保留元数据原始字面值，不分词且不转换大小写 */
  | { readonly kind: 'artist'; readonly name: string }
  /** 本地目录路径：支持定位至内部文件夹视图或调用系统文件管理器，无单一固定页面绑定 */
  | { readonly kind: 'folder'; readonly path: string }
  /** 流派字面值：保留原始元数据值，排除空串及保留前缀标识（见 isPlainGenre） */
  | { readonly kind: 'genre'; readonly value: string }
  /** 播放列表的 GUID 标识，不随名称变更或顺序调整变动 */
  | { readonly kind: 'playlist'; readonly guid: string }
  | { readonly kind: 'onlineList'; readonly list: OnlineListSubject }
  | { readonly kind: 'onlineAlbums'; readonly wall: OnlineAlbumsSubject };

/** 获取实体对象对应的目标地点；无直属页面（由打开器自闭环处理）的种类返回 null */
export function placeOf(ref: ObjectRef): Place | null {
  switch (ref.kind) {
    case 'album':
      return { id: 'album', subject: ref.key };
    case 'artist':
      return { id: 'artists', subject: ref.name };
    case 'folder':
      return null;
    case 'genre':
      return isPlainGenre(ref.value) ? { id: 'genres', subject: ref.value } : null;
    case 'playlist':
      return { id: 'playlist', subject: ref.guid };
    case 'onlineList':
      return { id: 'onlineList', subject: onlineListSubject(ref.list) };
    case 'onlineAlbums':
      return { id: 'onlineAlbums', subject: onlineAlbumsSubject(ref.wall) };
  }
}

/** 从导航地点反解实体对象；非实体地点或主体格式非法时返回 null */
export function refOf(place: Place): ObjectRef | null {
  const subject = place.subject;
  if (subject === undefined) return null;
  switch (place.id) {
    case 'album':
      // 专辑地点主体由 albumKeyOf 生成，直接对应专辑键
      return subject === '' ? null : { kind: 'album', key: subject as AlbumKey };
    case 'artists':
      return { kind: 'artist', name: subject };
    case 'genres':
      return isPlainGenre(subject) ? { kind: 'genre', value: subject } : null;
    case 'playlist':
      return subject === '' ? null : { kind: 'playlist', guid: subject };
    case 'onlineList': {
      const list = readOnlineListSubject(subject);
      return list ? { kind: 'onlineList', list } : null;
    }
    case 'onlineAlbums': {
      const wall = readOnlineAlbumsSubject(subject);
      return wall ? { kind: 'onlineAlbums', wall } : null;
    }
    default:
      return null;
  }
}

/**
 * 生成对象的稳定唯一键，用于记忆化比较与局部加载状态定位
 * 在线列表的展示标题属于入场快照，不纳入唯一标识
 */
export function refKey(ref: ObjectRef): string {
  switch (ref.kind) {
    case 'album':
      return `album\0${ref.key}`;
    case 'artist':
      return `artist\0${ref.name}`;
    case 'folder':
      return `folder\0${ref.path}`;
    case 'genre':
      return `genre\0${ref.value}`;
    case 'playlist':
      return `playlist\0${ref.guid}`;
    case 'onlineList':
      return `onlineList\0${ref.list.kind}\0${ref.list.ref.platform}\0${ref.list.ref.id}`;
    case 'onlineAlbums':
      return `onlineAlbums\0${ref.wall.ref.platform}\0${ref.wall.ref.id}\0${ref.wall.section}`;
  }
}
