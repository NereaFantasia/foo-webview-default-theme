import { albumYearOf, type Album } from '../../host/libraryContract.ts';

/**
 * 专辑按发行年份降序排列：缺失年份的专辑置于末尾，相同年份保持原有相对次序
 */
export function newestFirst<T>(items: readonly T[], albumOf: (item: T) => Album): T[] {
  return [...items].sort((a, b) => albumYearOf(albumOf(b)).localeCompare(albumYearOf(albumOf(a))));
}
