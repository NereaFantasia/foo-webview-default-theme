import type { MessageKey } from '../../i18n/en.ts';

/** 一组里的一项：对应预设可调项声明里的同名键，滑块旁的读数带上单位 */
export interface PanelItem {
  readonly key: string;
  readonly label: MessageKey;
  readonly unit?: '%' | 'px' | '°';
}

/**
 * 一组可调项：一个标题加几项，项的控件（开关、滑块、单选）由声明的种类决定
 *
 * 设置编辑里一组就是一个分类，标题就是分类名。`target` 是编辑时描出的那个元素，与元素根上的 `data-edit-target` 对应；
 * 不给就不描
 */
export interface PanelGroup {
  readonly title: MessageKey;
  readonly items: readonly PanelItem[];
  readonly target?: string;
}
