import { makeStyles } from '@fluentui/react-components';
import { LyricsKey, QueueKey } from './right-card/RightCardKeys.tsx';
import { NavButtons } from './NavButtons.tsx';
import styles from './NavRow.module.css';
import { SidebarKey } from '../nav/sidebar/SidebarKey.tsx';

// 胶囊里的键 40 × 30，悬停底也是胶囊；侧边栏键 30 见方，悬停底是圆。键的四周离描边内侧都是 2，悬停底的
// 圆角就与外框同心。
const useStyles = makeStyles({
  key: { minWidth: '40px', width: '40px', height: '30px', padding: '0' },
  round: { minWidth: '30px', width: '30px', height: '30px', padding: '0' },
  // 队列只有 20 的线框图标，缩到与其余键一样的 16。
  glyph: { width: '16px', height: '16px' },
});

/**
 * 内容卡顶部的导航行，只有播放栏在标题栏这一种形态有（另两种形态这几个键在标题栏）。固定一条，页面在它
 * 下面开始、切换动效也只作用在它下面。左边是「后退 前进」胶囊（两键之间一道竖线）与侧边栏键，右边是
 * 「歌词 队列」胶囊：队列键开合右侧卡的队列页；歌词页还没做，置灰但照样能聚焦、悬停提示写明即将推出。
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
        <QueueKey
          shape="circular"
          className={classes.key}
          glyphClassName={classes.glyph}
          marks={{ 'data-nav': 'queue' }}
        />
      </div>
    </div>
  );
}
