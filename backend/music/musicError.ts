import type { MusicFailureCode } from '../../src/server/musicProtocol.ts';

const MESSAGES: Readonly<Record<MusicFailureCode, string>> = {
  'invalid-request': '音乐请求无效',
  'not-configured': '尚未配置音源服务',
  'not-installed': '尚未下载网易云组件',
  'invalid-config': '音源服务配置无效',
  'catalog-unavailable': '无法读取或保存在线曲目记录',
  'track-missing': '未找到曲目记录，请重新搜索',
  'not-found': '音源里没有这张专辑、这个歌单或这位艺人',
  cancelled: '音乐请求已取消',
  timeout: '音源服务请求超时',
  authentication: '音源服务需要认证',
  'upstream-unavailable': '音源服务请求失败',
  'rate-limited': '音源服务提示请求过于频繁',
  'invalid-upstream': '音源服务返回的数据无法识别',
  unplayable: '未取得可用的播放地址',
  'membership-required': '只能取到试听片段，需要网易云会员',
  'unblock-missing': '第三方来源也没有这首曲目',
  'settings-unavailable': '无法保存音乐设置',
  'source-rejected': '这份音源脚本无法导入',
  unsupported: '音源不支持这项操作',
};

export class MusicError extends Error {
  /** `detail` 是上游失败应答的 JSON 正文，没读到或不是 JSON 时没有 */
  constructor(
    readonly code: MusicFailureCode,
    readonly detail?: unknown,
  ) {
    super(MESSAGES[code]);
  }
}
