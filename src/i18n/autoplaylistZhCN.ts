import type { autoplaylistEn } from './autoplaylistEn.ts';

/** 创建自动播放列表对话框的简体中文文案 */
export const autoplaylistZhCN: Record<keyof typeof autoplaylistEn, string> = {
  'autoplaylist.createTitle': '新建自动播放列表',
  'autoplaylist.editTitle': '编辑自动播放列表',
  'autoplaylist.name': '名称',
  'autoplaylist.query': '查询',
  'autoplaylist.sort': '排序',
  'autoplaylist.sortPlaceholder': '媒体库顺序',
  'autoplaylist.copySort': '复制排序',
  'autoplaylist.keepSorted': '保持排序',
  'autoplaylist.matchCountOne': '命中 {count} 首',
  'autoplaylist.matchCount': '命中 {count} 首',
  'autoplaylist.counting': '正在统计…',
  'autoplaylist.invalid': '查询有误',
  'autoplaylist.countFailed': '未能统计命中数',
  'autoplaylist.sortConflict': '「排序」框会盖过查询里的排序，请清空其中一处',
  'autoplaylist.createFailed': '未能创建',
  'autoplaylist.create': '创建',
  'autoplaylist.save': '保存',
  'autoplaylist.saveFailed': '未能保存，规则未改动',
  'autoplaylist.saveLost': '未能保存，这张列表现在是普通播放列表',
  'autoplaylist.native': '打开原生智能列表属性',
  'autoplaylist.unreadable': '无法读取这张列表的规则',
};
