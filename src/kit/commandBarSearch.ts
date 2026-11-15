import { createContext, useContext } from 'react';

/** 宽档下命令栏搜索框的定宽，像素；与 `CommandBar.module.css` 里 `.search` 的 flex-basis 一致 */
export const SEARCH_BASE_WIDTH = 320;
/** 搜索框随内容加宽的上限，像素 */
export const SEARCH_MAX_WIDTH = 800;

/** 搜索框告诉命令栏它想要多宽（像素）；null 是用定宽 */
export type ReportSearchWidth = (width: number | null) => void;

/** 命令栏之外没有提供者，上报什么都不做 */
export const SearchWidthContext = createContext<ReportSearchWidth>(() => {});

export function useReportSearchWidth(): ReportSearchWidth {
  return useContext(SearchWidthContext);
}
