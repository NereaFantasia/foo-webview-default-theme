import { defineLocalPref, ON_OFF } from '../../../kit/localPref.ts';

/**
 * 「动态艺术照」本地偏好开关（默认开启）：
 * 艺人页头部存在动态艺术照时，在静帧加载完成后静音循环播放；存储于本机浏览器偏好
 */
export const ARTIST_MOTION_PREF = defineLocalPref<boolean>({
  key: 'default-theme.artists.motion.v1',
  fallback: true,
  ...ON_OFF,
});
