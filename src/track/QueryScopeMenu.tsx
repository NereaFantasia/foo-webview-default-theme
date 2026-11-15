import { ScrollMenu as Menu, ScrollMenuPopover as MenuPopover } from '../kit/ScrollMenuPopover.tsx';
import {
  mergeClasses,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { BookInformation20Regular, Code16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { Fragment } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import { QUERY_SCOPES, type QueryScope } from './trackQuery.ts';
import styles from './QueryScopeMenu.module.css';
import { useViewControlStyles } from '../theme/controlStyles.ts';

const SCOPE_LABELS: Readonly<Record<QueryScope, MessageKey>> = {
  all: 'query.scopeAll',
  title: 'query.scopeTitle',
  artist: 'query.scopeArtist',
  albumArtist: 'query.scopeAlbumArtist',
  album: 'query.scopeAlbum',
  genre: 'query.scopeGenre',
  date: 'query.scopeDate',
  filename: 'query.scopeFilename',
  comment: 'query.scopeComment',
};

const useStyles = makeStyles({
  control: {
    flexShrink: 0,
    minWidth: 0,
    height: '24px',
    padding: `0 ${tokens.spacingHorizontalXS}`,
    columnGap: tokens.spacingHorizontalXS,
    whiteSpace: 'nowrap',
  },
  arrow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 0,
    marginRight: 0,
    lineHeight: 0,
  },
  invalid: { color: tokens.colorPaletteRedForeground1 },
});

/** 搜索框支持 fb2k 查询时的模式切换；不支持的搜索框不传 */
export interface QueryModeMenu {
  readonly active: boolean;
  /** 宿主认不出框里这串查询 */
  readonly invalid: boolean;
  onMode(advanced: boolean): void;
  /** 打开语法参考面板 */
  onReference(): void;
}

export interface QueryScopeMenuProps {
  readonly scope: QueryScope;
  onScope(scope: QueryScope): void;
  /** 普通搜索分不分字段；不分时（专辑页）普通搜索的键只剩一个图标，菜单只有切到高级查询这一项，默认分 */
  readonly scopes?: boolean;
  readonly advanced?: QueryModeMenu;
  /** 受控开合：查询出错时页面的「查询帮助」直接打开这份菜单 */
  readonly open?: boolean;
  onOpenChange?(open: boolean): void;
}

/**
 * 搜索框末尾的键。普通搜索时写当前范围，菜单是范围单选，末项切到高级查询；高级查询时写「高级」（出错写「查询有误」），
 * 菜单是语法参考与回到普通搜索。两种模式各自的草稿由页面持有，切换不互相转换
 */
export function QueryScopeMenu({
  scope,
  onScope,
  scopes = true,
  advanced,
  open,
  onOpenChange,
}: QueryScopeMenuProps) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const active = advanced?.active ?? false;
  // 不分字段又在普通搜索：键上没有范围可写，只用图标，提示写「高级查询」
  const bare = !scopes && !active;
  const value = active
    ? t(advanced?.invalid ? 'query.modeInvalid' : 'query.advancedShort')
    : t(SCOPE_LABELS[scope]);
  const name = bare
    ? t('query.advanced')
    : active
      ? t('query.mode')
      : `${t('query.scope')}: ${value}`;
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      open={open}
      onOpenChange={onOpenChange && ((_, data) => onOpenChange(data.open))}
      checkedValues={{ scope: [scope] }}
      onCheckedValueChange={(_, data) => {
        const next = QUERY_SCOPES.find((one) => data.checkedItems.includes(one));
        if (next) onScope(next);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={name} relationship="label">
          <MenuButton
            className={mergeClasses(
              classes.control,
              controls.icon,
              active && advanced?.invalid && classes.invalid,
            )}
            size="small"
            appearance="subtle"
            menuIcon={{ className: classes.arrow }}
            icon={bare ? <Code16Regular /> : undefined}
            aria-label={name}
            data-query-scope={active ? 'advanced' : scope}
          >
            {!bare && <span className={styles.label}>{value}</span>}
          </MenuButton>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        {active && advanced ? (
          <MenuList aria-label={t('query.mode')}>
            <MenuItem
              icon={<BookInformation20Regular />}
              onClick={advanced.onReference}
              data-query-reference
            >
              {t('query.syntax.reference')}
            </MenuItem>
            <MenuDivider />
            <MenuItem onClick={() => advanced.onMode(false)} data-query-mode="text">
              {t('query.backToText')}
            </MenuItem>
          </MenuList>
        ) : (
          <MenuList aria-label={t('query.scope')}>
            {scopes &&
              QUERY_SCOPES.map((one) => (
                <Fragment key={one}>
                  {one === 'filename' && <MenuDivider />}
                  <MenuItemRadio name="scope" value={one}>
                    {t(SCOPE_LABELS[one])}
                  </MenuItemRadio>
                </Fragment>
              ))}
            {advanced && (
              <>
                {scopes && <MenuDivider />}
                <MenuItem
                  icon={<Code16Regular />}
                  onClick={() => advanced.onMode(true)}
                  data-query-mode="advanced"
                >
                  {t('query.advanced')}
                </MenuItem>
              </>
            )}
          </MenuList>
        )}
      </MenuPopover>
    </Menu>
  );
}
