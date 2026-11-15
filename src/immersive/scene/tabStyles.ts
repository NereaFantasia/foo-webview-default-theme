import { makeStyles, tokens } from '@fluentui/react-components';
import { roleVar } from '../../theme/roles.ts';

/**
 * 控制层顶部正中那一排文字页签的样式：间距 24，选中项用主文字色加强调色下划线，悬停提亮文字
 *
 * 侧栏的「歌词 队列 历史」与设置编辑条上的分类是同一种页签，改一处另一处跟着变
 */
export const useSceneTabStyles = makeStyles({
  list: { columnGap: tokens.spacingHorizontalXXL },
  tab: {
    paddingInline: '0',
    minHeight: '32px',
    color: roleVar('text-secondary'),
    ':hover': { color: roleVar('text-primary') },
    '&[aria-selected="true"]': { color: roleVar('text-primary') },
    '&[aria-selected="true"]::after': {
      height: '2px',
      borderRadius: '1px',
      backgroundColor: roleVar('accent'),
    },
  },
  text: { fontSize: tokens.fontSizeBase300, lineHeight: tokens.lineHeightBase300 },
});
