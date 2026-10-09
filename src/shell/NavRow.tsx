import { makeStyles } from '@fluentui/react-components';
import { LyricsKey, QueueKey } from './right-card/RightCardKeys.tsx';
import { NavButtons } from './NavButtons.tsx';
import styles from './NavRow.module.css';
import { SidebarKey } from '../nav/sidebar/SidebarKey.tsx';

// 胶囊里的键 40 × 30，悬停底也是胶囊；侧边栏键 30 见方，悬停底是圆。键的四周离描边内侧都是 2，悬停底的
// 圆角就与外框同心。图标与标题栏的导航键一样，都是 20。
const useStyles = makeStyles({
  key: {
    minWidth: '40px',
    width: '40px',
    height: '30px',
    padding: '0',
    '& svg': { width: '20px', height: '20px' },
  },
  round: {
    minWidth: '30px',
    width: '30px',
    height: '30px',
    padding: '0',
    '& svg': { width: '20px', height: '20px' },
  },
});

/**
 * 标题栏播放形态的悬浮导航键；页面切换不带着按钮移动。左边是后退、前进与侧边栏，右边是歌词与队列。
 * 整页滚动的内容在页首让位，滚动后可进入按钮下方；固定工具栏保持原位，按钮组之间的空白不拦截页面操作。
 */
export function NavRow() {
  const classes = useStyles();
  return (
    <div className={styles.root} data-nav-row>
      <div className={styles.group}>
        <div className={styles.capsule}>
          <NavButtons className={classes.key} divided />
        </div>
        <div className={styles.ring}>
          <SidebarKey className={classes.round} />
        </div>
      </div>
      <div className={styles.capsule}>
        <LyricsKey shape="circular" className={classes.key} marks={{ 'data-nav': 'lyrics' }} />
        <QueueKey shape="circular" className={classes.key} marks={{ 'data-nav': 'queue' }} />
      </div>
    </div>
  );
}
