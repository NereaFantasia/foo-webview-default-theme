import {
  ArrowRepeat116Regular,
  ArrowRepeat120Regular,
  ArrowRepeatAll16Regular,
  ArrowRepeatAll20Regular,
  ArrowRight16Regular,
  ArrowRight20Regular,
  ArrowShuffle16Regular,
  ArrowShuffle20Regular,
  FolderOpen16Regular,
  FolderOpen20Regular,
  MusicNote216Regular,
  MusicNote220Regular,
  Record16Regular,
  Record20Regular,
  Speaker016Regular,
  Speaker020Regular,
  Speaker116Regular,
  Speaker120Regular,
  Speaker216Regular,
  Speaker220Regular,
  SpeakerMute16Regular,
  SpeakerMute20Regular,
  type FluentIcon,
} from '@fluentui/react-icons';
import type { OrderName } from '../../playback/playbackOrder.ts';
import type { VolumeLevel } from './volume/volumeControl.ts';

/** 输出面板与浮层里的静音图标，16px；随音量档与静音变。 */
export const VOLUME_ICONS: Readonly<Record<VolumeLevel, FluentIcon>> = {
  muted: SpeakerMute16Regular,
  low: Speaker016Regular,
  mid: Speaker116Regular,
  high: Speaker216Regular,
};

/** 播放栏的音量与静音图标，20px；三种布局共用。 */
export const VOLUME_ICONS_LARGE: Readonly<Record<VolumeLevel, FluentIcon>> = {
  muted: SpeakerMute20Regular,
  low: Speaker020Regular,
  mid: Speaker120Regular,
  high: Speaker220Regular,
};

/** 播放顺序键上的图标，16 像素；与菜单里那一套同形。 */
export const ORDER_KEY_ICONS: Readonly<Record<OrderName, FluentIcon>> = {
  default: ArrowRight16Regular,
  'repeat-playlist': ArrowRepeatAll16Regular,
  'repeat-track': ArrowRepeat116Regular,
  random: ArrowShuffle16Regular,
  'shuffle-tracks': MusicNote216Regular,
  'shuffle-albums': Record16Regular,
  'shuffle-folders': FolderOpen16Regular,
};

/** 播放顺序菜单各项的图标：菜单项的图标槽是 20 像素；播放栏的顺序键也用这一套。 */
export const ORDER_MENU_ICONS: Readonly<Record<OrderName, FluentIcon>> = {
  default: ArrowRight20Regular,
  'repeat-playlist': ArrowRepeatAll20Regular,
  'repeat-track': ArrowRepeat120Regular,
  random: ArrowShuffle20Regular,
  'shuffle-tracks': MusicNote220Regular,
  'shuffle-albums': Record20Regular,
  'shuffle-folders': FolderOpen20Regular,
};
