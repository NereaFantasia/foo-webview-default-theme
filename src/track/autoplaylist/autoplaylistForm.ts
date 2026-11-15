import { diagnose, type Issue } from '../syntax/queryDiagnose.ts';
import { lexQuery } from '../syntax/queryLexer.ts';
import { splitSortClause } from '../syntax/querySort.ts';
import type { AutoplaylistPreview } from './autoplaylistPreview.ts';

/** 一张自动播放列表的规则：查询、排序、保持排序 */
export interface AutoplaylistRules {
  /** 可以在末尾带 `SORT DESCENDING BY …`：降序只能写在这里 */
  readonly query: string;
  /** Title Formatting 排序串，空串是媒体库顺序；查询里带了排序子句时必须是空串 */
  readonly sort: string;
  readonly keepSorted: boolean;
}

/** 创建时对话框交出的一份：名称加规则；编辑时名称不用 */
export interface AutoplaylistRequest extends AutoplaylistRules {
  readonly name: string;
}

/** 提交的结局：做成了；没做成、列表仍是原样；没做成且列表已经不再是自动播放列表（只有编辑会走到） */
export type AutoplaylistOutcome = 'done' | 'failed' | 'lost';

/**
 * 将当前页面条件转换为对话框预填内容；宿主规则：自动播放列表降序仅支持写入查询（`SORT DESCENDING BY`），
 * 独立的排序串留空；给了非空的排序串，查询里的排序子句会被静默忽略，结果回到升序
 */
export function autoplaylistInitial(
  name: string,
  fill: { readonly query: string; readonly sort: string; readonly descending: boolean },
): AutoplaylistRequest {
  const sort = fill.sort.trim();
  if (fill.descending && sort !== '') {
    return { name, query: `${fill.query} SORT DESCENDING BY ${sort}`, sort: '', keepSorted: false };
  }
  return { name, query: fill.query, sort: fill.sort, keepSorted: false };
}

/** 交宿主数命中数的那一段：查询去掉末尾的排序子句（`library.query` 不收排序），去首尾空白 */
export function conditionOf(query: string): string {
  return splitSortClause(query).condition.trim();
}

/** 预览条写什么 */
export type PreviewLine =
  | { readonly kind: 'none' }
  | { readonly kind: 'counting' }
  | { readonly kind: 'count'; readonly total: number }
  /** 宿主还没确认，本地诊断已经指得出错在哪 */
  | { readonly kind: 'issue'; readonly issue: Issue }
  /** 宿主认不出这串查询 */
  | { readonly kind: 'invalid' }
  /** 没数成：不知道命中多少，也不知道查询对不对 */
  | { readonly kind: 'failed' }
  /** 查询里带了排序子句，「排序」框又不空：宿主以「排序」框为准，查询里的排序会被悄悄忽略 */
  | { readonly kind: 'sortConflict' };

/**
 * 预览条展示内容；结果以宿主响应为准：宿主返回命中数时优先展示命中数；等待响应或宿主未识别时，
 * 若本地诊断能够指出具体错误则优先呈现，比通用「查询有误」更明确；
 * 排序冲突优先级最高：排序框与查询子句冲突会导致实际排序偏离预期
 */
export function previewLineOf(
  query: string,
  sort: string,
  preview: AutoplaylistPreview,
): PreviewLine {
  const condition = conditionOf(query);
  // 只剩排序子句、没有条件的也不数：没有可数的
  if (condition === '') return { kind: 'none' };
  if (splitSortClause(query).clause && sort.trim() !== '') return { kind: 'sortConflict' };
  const current = preview.status !== 'idle' && preview.query === condition;
  if (current && preview.status === 'ready') return { kind: 'count', total: preview.total };
  const issue = diagnose(lexQuery(query)).find((one) => one.level === 'error');
  if (issue) return { kind: 'issue', issue };
  if (current && preview.status === 'invalid') return { kind: 'invalid' };
  if (current && preview.status === 'failed') return { kind: 'failed' };
  return { kind: 'counting' };
}

/** 能不能提交：名称不空（编辑没有名称，给 null），且宿主已经对框里这一串数出了命中数；预览在路上时不能 */
export function canCreate(name: string | null, line: PreviewLine): boolean {
  return (name === null || name.trim() !== '') && line.kind === 'count';
}
