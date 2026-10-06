import { ToggleButton, Tooltip, type ButtonProps } from '@fluentui/react-components';
import { CommentText16Regular, MusicNote2Play20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { RIGHT_CARD_KEY_ATTR } from './rightCardContext.ts';
import { useService } from '../../kit/useService.ts';
import { rightCardKey } from './rightCardServices.ts';

export interface RightCardKeyProps {
  readonly className?: string;
  /** 队列只有 20 的线框图标，放进 16 的键组时缩到 16。 */
  readonly glyphClassName?: string;
  readonly shape?: ButtonProps['shape'];
  /** 键上另挂的标识，如导航行的 `data-nav`。 */
  readonly marks?: Readonly<Record<`data-${string}`, string>>;
}

/**
 * 右侧卡队列页的开合键：点了开到队列页，卡开着又停在队列页时收起；这时键亮着。按在它上面不算右侧卡浮层的
 * 「外面」，免得窄窗里按下时关掉、松开的单击又打开。导航行、标题栏各放一枚，看播放栏是哪种形态。
 */
export function QueueKey({ className, glyphClassName, shape, marks }: RightCardKeyProps) {
  const t = useAtomValueRawSync(translateAtom);
  const rightCard = useService(rightCardKey);
  const { form, prefs } = useAtomValueRawSync(rightCard.card.view);
  const lit = form !== 'none' && prefs.page === 'queue';
  return (
    <Tooltip content={t('nav.queue')} relationship="label">
      <ToggleButton
        appearance="subtle"
        shape={shape}
        className={className}
        icon={<MusicNote2Play20Regular className={glyphClassName} />}
        checked={lit}
        onClick={() => rightCard.card.toggle('queue')}
        {...{ [RIGHT_CARD_KEY_ATTR]: 'queue' }}
        {...marks}
      />
    </Tooltip>
  );
}

/** 与队列键使用同一个右侧卡；浮层外部点击识别同一份入口标记。 */
export function LyricsKey({ className, shape, marks }: RightCardKeyProps) {
  const t = useAtomValueRawSync(translateAtom);
  const rightCard = useService(rightCardKey);
  const { form, prefs } = useAtomValueRawSync(rightCard.card.view);
  return (
    <Tooltip content={t('nav.lyrics')} relationship="label">
      <ToggleButton
        appearance="subtle"
        shape={shape}
        className={className}
        icon={<CommentText16Regular />}
        checked={form !== 'none' && prefs.page === 'lyrics'}
        onClick={() => rightCard.card.toggle('lyrics')}
        {...{ [RIGHT_CARD_KEY_ATTR]: 'lyrics' }}
        {...marks}
      />
    </Tooltip>
  );
}
