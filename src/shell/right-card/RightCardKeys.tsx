import {
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  ToggleButton,
  Tooltip,
  mergeClasses,
  type ButtonProps,
} from '@fluentui/react-components';
import {
  CommentText16Regular,
  DocumentBulletList20Regular,
  MoreVertical20Regular,
  MusicNote2Play20Regular,
  Person20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState, type ReactElement } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { MessageKey } from '../../i18n/en.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { Menu } from '../../motion/Surfaces.tsx';
import { MenuSurface as MenuPopover } from '../../theme/MenuSurface.tsx';
import { useMediaQuery } from '../../kit/useMediaQuery.ts';
import { RIGHT_CARD_KEY_ATTR } from './rightCardContext.ts';
import { useService } from '../../kit/useService.ts';
import { RIGHT_CARD_PAGES, type RightCardPage } from './rightCard.ts';
import { rightCardKey } from './rightCardServices.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

interface RightCardKeyProps {
  readonly className?: string;
  /** 队列只有 20 的线框图标，放进 16 的键组时缩到 16 */
  readonly glyphClassName?: string;
  readonly shape?: ButtonProps['shape'];
  /** 键上另挂的标识，如导航行的 `data-nav` */
  readonly marks?: Readonly<Record<`data-${string}`, string>>;
}

/**
 * 右侧卡一页的开合键：点了开到这一页，卡开着又停在这一页时收起；这时键亮着。按在它上面不算右侧卡浮层的
 * 「外面」，免得窄窗里按下时关掉、松开的单击又打开。导航行、标题栏各放一组，看播放栏是哪种形态
 */
function PageKey({
  page,
  label,
  icon,
  className,
  shape,
  marks,
}: RightCardKeyProps & {
  readonly page: RightCardPage;
  readonly label: MessageKey;
  readonly icon: ReactElement;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const rightCard = useService(rightCardKey);
  const { form, prefs } = useAtomValueRawSync(rightCard.card.view);
  const [tip, setTip] = useState(false);
  const controls = useViewControlStyles();
  return (
    <Tooltip
      content={t(label)}
      relationship="label"
      visible={tip && form !== 'overlay'}
      onVisibleChange={(_, data) => setTip(data.visible)}
    >
      <ToggleButton
        appearance="subtle"
        shape={shape}
        className={mergeClasses(controls.icon, className)}
        icon={icon}
        checked={form !== 'none' && prefs.page === page}
        onClick={() => rightCard.card.toggle(page)}
        {...{ [RIGHT_CARD_KEY_ATTR]: page }}
        {...marks}
      />
    </Tooltip>
  );
}

function QueueKey({ glyphClassName, ...props }: RightCardKeyProps) {
  return (
    <PageKey
      page="queue"
      label="nav.queue"
      icon={<MusicNote2Play20Regular className={glyphClassName} />}
      {...props}
    />
  );
}

function LyricsKey(props: RightCardKeyProps) {
  return <PageKey page="lyrics" label="nav.lyrics" icon={<CommentText16Regular />} {...props} />;
}

function InfoKey(props: RightCardKeyProps) {
  return <PageKey page="info" label="nav.info" icon={<DocumentBulletList20Regular />} {...props} />;
}

function BioKey(props: RightCardKeyProps) {
  return <PageKey page="bio" label="nav.bio" icon={<Person20Regular />} {...props} />;
}

/** 收进菜单的三页，队列键单独显示 */
const FOLDED_PAGES: readonly RightCardPage[] = RIGHT_CARD_PAGES.filter((page) => page !== 'queue');

/**
 * 右侧卡四页的入口，从左到右：队列、歌词、信息、简介，常用的两页排在前面，顺序与卡里页的先后一致
 * 窗口满足 `foldWhen`（媒体查询）时放不下四个键：队列键照旧，其余三页收进后面的菜单键。
 * 满足 `foldQueueWhen` 时队列键也放不下，四页全部收进菜单键
 * `navMarks` 给每个键挂 `data-nav`，值是页名
 */
export function RightCardPageKeys({
  foldWhen,
  foldQueueWhen,
  navMarks = false,
  ...props
}: RightCardKeyProps & {
  readonly foldWhen: string;
  readonly foldQueueWhen?: string;
  readonly navMarks?: boolean;
}) {
  const folded = useMediaQuery(foldWhen);
  // 未传入时使用永不成立的查询，hook 仍每次调用
  const queueFolded = useMediaQuery(foldQueueWhen ?? 'not all');
  const marks = (page: RightCardPage) =>
    navMarks ? { ...props.marks, 'data-nav': page } : props.marks;
  if (queueFolded) {
    return (
      <RightCardPagesKey className={props.className} shape={props.shape} pages={RIGHT_CARD_PAGES} />
    );
  }
  if (folded) {
    return (
      <>
        <QueueKey {...props} marks={marks('queue')} />
        <RightCardPagesKey className={props.className} shape={props.shape} pages={FOLDED_PAGES} />
      </>
    );
  }
  return (
    <>
      <QueueKey {...props} marks={marks('queue')} />
      <LyricsKey {...props} marks={marks('lyrics')} />
      <InfoKey {...props} marks={marks('info')} />
      <BioKey {...props} marks={marks('bio')} />
    </>
  );
}

/**
 * 收起的各页共用的菜单键。菜单以单选项列出这些页，选中后右侧卡开到该页。
 * 卡开着又停在选中的那一页时不收起，收起交给卡自己的外部点击与 Esc。属性值不是页名，悬停预览不认它
 */
function RightCardPagesKey({
  className,
  shape,
  pages,
}: RightCardKeyProps & { readonly pages: readonly RightCardPage[] }) {
  const t = useAtomValueRawSync(translateAtom);
  const rightCard = useService(rightCardKey);
  const { form, prefs } = useAtomValueRawSync(rightCard.card.view);
  const controls = useViewControlStyles();
  const shown = form !== 'none';
  const current = shown && pages.includes(prefs.page) ? prefs.page : null;
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      checkedValues={{ page: current ? [current] : [] }}
      onCheckedValueChange={(_, data) => {
        const next = pages.find((page) => page === data.checkedItems[0]);
        if (next && next !== current) rightCard.card.toggle(next);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <ToggleButton
          appearance="subtle"
          shape={shape}
          className={mergeClasses(controls.icon, className)}
          icon={<MoreVertical20Regular />}
          checked={current !== null}
          aria-label={t('rightCard.pages')}
          {...{ [RIGHT_CARD_KEY_ATTR]: 'pages' }}
        />
      </MenuTrigger>
      <MenuPopover data-right-card-surface>
        <MenuList>
          {pages.map((page) => (
            <MenuItemRadio key={page} name="page" value={page}>
              {t(`rightCard.page.${page}`)}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
