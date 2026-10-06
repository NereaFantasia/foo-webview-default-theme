import type { MessageKey } from '../../i18n/en.ts';
import { presetOf } from '../../track/queryPresets.ts';
import type { HomeChannel } from './homeChannels.ts';
import { homeGemQuery } from './homeModel.ts';

export interface HomeChannelTemplate {
  readonly id: string;
  readonly label: MessageKey;
  readonly query: string;
  readonly statistics: boolean;
}

export const HOME_CHANNEL_TEMPLATES: readonly HomeChannelTemplate[] = [
  {
    id: 'rated',
    label: 'home.templateRated',
    query: presetOf('highRated').query,
    statistics: false,
  },
  { id: 'lossless', label: 'query.lossless', query: presetOf('lossless').query, statistics: false },
  {
    id: 'forgotten',
    label: 'home.templateForgotten',
    query: homeGemQuery('forgotten'),
    statistics: true,
  },
  { id: 'unplayed', label: 'home.unplayed', query: homeGemQuery('unplayed'), statistics: true },
];

export type HomeChannelDraft = Pick<HomeChannel, 'name' | 'query' | 'sort'>;
