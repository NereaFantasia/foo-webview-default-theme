import { biographyArtist } from './biographyModel.ts';

export interface BiographyCandidates {
  /** 可查询简介的艺人候选列表，保持标签元数据顺序 */
  readonly names: readonly string[];
  /** 默认展示的首选艺人；无候选时为 null */
  readonly lead: string | null;
}

/** 空候选结果常量 */
export const NO_CANDIDATES: BiographyCandidates = { names: [], lead: null };

function normalized(names: readonly string[]): readonly string[] {
  return names.flatMap((name) => {
    const artist = biographyArtist(name);
    return artist ? [artist] : [];
  });
}

/**
 * 解析单曲中可查询简介的艺人候选：
 * 优先按多值标签拆分，缺失时取单值 `artist`，完成空值过滤、去重与合辑名称剔除；
 * 不拆解合并署名字符串，亦不主动回落至专辑艺人
 *
 * 首选艺人规则：曲目艺人包含专辑艺人时优先选取专辑艺人，以匹配封面归属；未匹配（如合辑或缺失专辑艺人）时选取首位候选
 */
export function biographyCandidates(track: {
  readonly artist?: string | undefined;
  readonly artists?: readonly string[] | undefined;
  readonly albumArtist?: string | undefined;
  readonly albumArtists?: readonly string[] | undefined;
}): BiographyCandidates {
  const names = [
    ...new Set(normalized(track.artists?.length ? track.artists : [track.artist ?? ''])),
  ];
  const owners = normalized(
    track.albumArtists?.length ? track.albumArtists : [track.albumArtist ?? ''],
  );
  return { names, lead: owners.find((name) => names.includes(name)) ?? names[0] ?? null };
}

/** 选取艺人：若用户指定艺人存在于候选列表中则沿用，否则回退至默认首选艺人 */
export function pickBiographyArtist(
  candidates: BiographyCandidates,
  chosen: string | null,
): string | null {
  return chosen !== null && candidates.names.includes(chosen) ? chosen : candidates.lead;
}
