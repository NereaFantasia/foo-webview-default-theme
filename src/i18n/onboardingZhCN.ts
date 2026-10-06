import type { onboardingEn } from './onboardingEn.ts';

/** 新人引导的中文文案，并进简体中文包。键集按英文那一份标注，缺键编译不过。 */
export const onboardingZhCN: Record<keyof typeof onboardingEn, string> = {
  'onboarding.step': '第 {current} 步，共 {total} 步',
  'onboarding.titleLibrary': '媒体库',
  'onboarding.titleAppearance': '外观',
  'onboarding.titleTray': '托盘',
  'onboarding.titleUpdate': '更新与联网',
  'onboarding.skip': '跳过引导',
  'onboarding.back': '上一步',
  'onboarding.next': '下一步',
  'onboarding.done': '完成',
  'onboarding.addFolders': '添加文件夹',
  'onboarding.manageFolders': '管理文件夹',
  'onboarding.libraryReading': '正在读取媒体库',
  'onboarding.libraryFailed': '媒体库状态读取失败',
  'onboarding.libraryNone': '尚未添加文件夹',
  'onboarding.libraryNoTracks': '尚未找到曲目',
  'onboarding.libraryTracksOne': '共 {count} 首',
  'onboarding.libraryTracks': '共 {count} 首',
  'onboarding.rootTracksOne': '{count} 首',
  'onboarding.rootTracks': '{count} 首',
  'onboarding.moreRoots': '等 {count} 个',
};
