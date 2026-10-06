import type { TableItem, TableTrack } from '../../src/table/tableItems.ts';
import { makeTrack } from './tracks.ts';

// 表格试验页的场景：地址栏参数、按参数造的节 / 专辑 / 曲目树与摊平后的条目流，以及交给调用方的动作记录。

export interface HarnessScenario {
  /** 最外层的节数；0 时专辑就是最外层。 */
  readonly sections: number;
  /** 每节几张专辑；0 时不分组，`rows` 是总行数。 */
  readonly albums: number;
  readonly rows: number;
  readonly cover: boolean;
  readonly sortable: boolean;
  readonly groupFocus: boolean;
  readonly typing: boolean;
  /** 打字即跳由试验页自己做（`typeSearch`），找到后经句柄的 `reveal` 落焦点并选中。 */
  readonly asyncSearch: boolean;
  /** 行序号从这里起的曲目还没取到，画骨架；负数是全都取到了。 */
  readonly pending: number;
  readonly loading: boolean;
  /** 把 `onRange` 报的区间记进动作记录。 */
  readonly range: boolean;
  /** 评分戳按行给：每这么多行一页、各拿一个戳；0 是整张表一个戳。 */
  readonly pageStamps: number;
  /** 列头菜单带上排序与分组两段，见 `useHarnessMenu`。 */
  readonly menu: boolean;
  /** 列存档的键。 */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** 行跟着外面的滚动盒滚（`scrollParent`），表格上方垫一块 `above` 高的内容，盒底留 `below` 的内边距。 */
  readonly page: boolean;
  readonly above: number;
  readonly below: number;
}

export function scenarioFrom(search: string): HarnessScenario {
  const query = new URLSearchParams(search);
  const count = (name: string, fallback: number) => Number(query.get(name) ?? fallback) || 0;
  const flag = (name: string) => query.get(name) === '1';
  const key = query.get('key');
  if (!key) throw new Error('试验页的地址缺少 key');
  return {
    sections: count('sections', 0),
    albums: count('albums', 0),
    rows: count('rows', 50),
    cover: flag('cover'),
    sortable: flag('sortable'),
    groupFocus: flag('groupFocus'),
    typing: flag('typing'),
    asyncSearch: flag('asyncSearch'),
    pending: Number(query.get('pending') ?? -1),
    loading: flag('loading'),
    range: flag('range'),
    pageStamps: count('pageStamps', 0),
    menu: flag('menu'),
    key,
    width: count('width', 900),
    height: count('height', 480),
    page: flag('page'),
    above: count('above', 300),
    below: count('below', 0),
  };
}

export interface HarnessGroup {
  readonly label: string;
  /** 外面那一层的键；同一层、同一个外层的是同级。 */
  readonly parent: string | null;
}

interface Node {
  readonly key: string;
  readonly label: string;
  readonly children: readonly Node[];
  readonly tracks: readonly (TableTrack | undefined)[];
}

/** 记一条交给调用方的动作，测试在 Node 那边经 `harnessLog` 读出来。 */
export function log(entry: Readonly<Record<string, unknown>>): void {
  const list: unknown = Reflect.get(window, '__tableLog');
  if (Array.isArray(list)) list.push(entry);
  else Reflect.set(window, '__tableLog', [entry]);
}

function trackAt(order: number, album: number): TableTrack {
  const number = String(order + 1).padStart(4, '0');
  return makeTrack({
    path: `file://E:/Music/Album ${album}/${number}.flac`,
    title: `Track ${number}`,
    artist: ['Nujabes', 'Fat Jon', 'Shing02'][order % 3] ?? '',
    album: `Album ${album}`,
    trackNumber: (order % 12) + 1,
    duration: 120 + (order % 90),
  });
}

/** 造一棵节、专辑、曲目三层的树；行序号按曲目在整棵树里的先后编。 */
export function buildTree(scenario: HarnessScenario): readonly Node[] {
  let order = 0;
  const album = (key: string, at: number): Node => ({
    key,
    label: `Album ${at}`,
    children: [],
    tracks: Array.from({ length: scenario.rows }, () => {
      const position = order++;
      return scenario.pending >= 0 && position >= scenario.pending
        ? undefined
        : trackAt(position, at);
    }),
  });
  if (scenario.albums === 0) return [{ ...album('all', 0), key: '' }];
  let albumAt = 0;
  const albums = () =>
    Array.from({ length: scenario.albums }, () => album(`a${albumAt}`, albumAt++));
  if (scenario.sections === 0) return albums();
  return Array.from({ length: scenario.sections }, (_, at) => ({
    key: `s${at}`,
    label: `Section ${at}`,
    children: albums(),
    tracks: [],
  }));
}

/** 按折叠状态摊成条目流；展开着的组不够 `fillers` 行时在组尾垫空位。 */
export function flatten(
  nodes: readonly Node[],
  collapsed: ReadonlySet<string>,
  fillers: number,
): TableItem<HarnessGroup>[] {
  const items: TableItem<HarnessGroup>[] = [];
  let order = 0;
  const walk = (node: Node, level: number, parent: string | null) => {
    const grouped = node.key !== '';
    const shut = grouped && collapsed.has(node.key);
    if (grouped) {
      const data = { label: node.label, parent };
      items.push({ kind: 'group', key: node.key, level, collapsed: shut, data });
    }
    for (const child of node.children) walk(child, level + 1, node.key);
    for (const track of node.tracks) {
      if (!shut) items.push({ kind: 'row', key: `r${order}`, order, track });
      order += 1;
    }
    const pad = grouped && !shut && node.tracks.length > 0 ? fillers - node.tracks.length : 0;
    for (let at = 0; at < pad; at += 1) items.push({ kind: 'filler', key: `${node.key}.f${at}` });
  };
  for (const node of nodes) walk(node, 0, null);
  return items;
}
