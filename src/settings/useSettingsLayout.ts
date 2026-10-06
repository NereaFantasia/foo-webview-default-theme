import { createContext, useContext } from 'react';

/** 卡宽的分界，CSS 像素：不足这个宽度时，下拉框放不进标题右边。 */
export const CARD_FIELD_MIN_WIDTH = 480;
/** 页宽的分界：不足这个宽度时，分类目录收成页标题下面的一行。 */
export const PAGE_NAV_MIN_WIDTH = 640;

export interface SettingsLayout {
  /** 卡列窄于 `CARD_FIELD_MIN_WIDTH`：下拉框换到标题下面、占满一行。 */
  readonly compact: boolean;
}

/** 卡列此刻的排法，由设置页量好给下面的各张卡；各张卡同宽，不必各自去量。 */
export const SettingsLayoutContext = createContext<SettingsLayout>({ compact: false });

export function useSettingsLayout(): SettingsLayout {
  return useContext(SettingsLayoutContext);
}
