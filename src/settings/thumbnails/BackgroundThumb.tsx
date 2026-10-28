import type { BackgroundTile } from '../windowBackgroundChoice.ts';
import styles from './BackgroundThumb.module.css';
import art from './background-art.webp';
import cover from './background-cover.webp';
import palette from './background-palette.webp';

type Tone = 'pane' | 'soft' | 'mid' | 'hard';

interface BarProps {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly tone: Tone;
  readonly r?: number;
}

function Bar({ x, y, w, h, tone, r = h / 2 }: BarProps) {
  return <rect x={x} y={y} width={w} height={h} rx={r} className={styles[tone]} />;
}

/** 界面骨架层，以半透明色块示意侧边栏、网格与播放栏布局 */
function Skeleton() {
  const rows = Array.from({ length: 6 }, (_, index) => 128 + index * 46);
  return (
    <svg
      className={styles.skeleton}
      viewBox="0 0 1280 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
    >
      <Bar x={36} y={72} w={204} h={34} r={8} tone="soft" />
      <Bar x={46} y={84} w={14} h={14} tone="mid" />
      <Bar x={70} y={87} w={70} h={9} tone="mid" />
      {rows.map((y, index) => (
        <g key={y}>
          {index === 2 && <Bar x={30} y={y - 5} w={216} h={40} r={8} tone="soft" />}
          {index === 2 && <Bar x={30} y={y + 6} w={4} h={18} tone="hard" />}
          <Bar x={46} y={y + 2} w={22} h={22} r={6} tone={index === 2 ? 'hard' : 'mid'} />
          <Bar
            x={82}
            y={y + 7}
            w={60 + ((index * 23) % 50)}
            h={12}
            tone={index === 2 ? 'hard' : 'mid'}
          />
        </g>
      ))}
      <Bar x={46} y={424} w={84} h={11} tone="mid" />
      {[0, 1, 2].map((index) => (
        <g key={index}>
          <Bar x={46} y={454 + index * 40} w={18} h={18} r={4} tone="soft" />
          <Bar x={76} y={458 + index * 40} w={90 + index * 20} h={11} tone="soft" />
        </g>
      ))}
      <Bar x={272} y={56} w={988} h={640} r={14} tone="pane" />
      <Bar x={304} y={84} w={116} h={36} r={8} tone="hard" />
      <Bar x={432} y={96} w={56} h={14} tone="soft" />
      <Bar x={304} y={140} w={88} h={34} r={8} tone="soft" />
      <Bar x={402} y={140} w={280} h={34} r={8} tone="soft" />
      <Bar x={692} y={140} w={120} h={34} r={8} tone="soft" />
      <Bar x={822} y={140} w={144} h={34} r={8} tone="soft" />
      {Array.from({ length: 8 }, (_, index) => {
        const x = 304 + (index % 4) * 238;
        const y = 196 + Math.floor(index / 4) * 296;
        return (
          <g key={index}>
            <Bar x={x} y={y} w={200} h={200} r={10} tone="mid" />
            <Bar x={x} y={y + 212} w={150} h={14} tone="hard" />
            <Bar x={x} y={y + 236} w={100} h={12} tone="soft" />
          </g>
        );
      })}
      <Bar x={60} y={716} w={1160} h={4} tone="soft" />
      <Bar x={60} y={716} w={330} h={4} tone="hard" />
      <Bar x={24} y={734} w={56} h={56} r={6} tone="mid" />
      <Bar x={96} y={742} w={150} h={14} tone="hard" />
      <Bar x={96} y={766} w={110} h={11} tone="soft" />
      <Bar x={535} y={753} w={18} h={18} tone="mid" />
      <Bar x={579} y={753} w={18} h={18} tone="hard" />
      <Bar x={615} y={737} w={50} h={50} tone="hard" />
      <Bar x={683} y={753} w={18} h={18} tone="hard" />
      <Bar x={1021} y={753} w={18} h={18} tone="mid" />
      <Bar x={1060} y={760} w={110} h={4} tone="soft" />
      <Bar x={1060} y={760} w={70} h={4} tone="hard" />
    </svg>
  );
}

/** 背景缩略底图层，以 16:10 比例铺满容器 */
function Backdrop({ src, name, dim = false }: { src: string; name: string; dim?: boolean }) {
  return (
    <img
      className={dim ? `${styles.backdrop} ${styles.dim}` : styles.backdrop}
      src={src}
      alt=""
      draggable={false}
      data-backdrop-art={name}
    />
  );
}

/**
 * 窗口背景来源预览缩略图，在统一界面骨架下呈现各来源的视觉渲染特征
 *
 * 骨架遮罩采用固定静态中性色，突出背景差异
 */
export function BackgroundThumb({ tile }: { readonly tile: BackgroundTile }) {
  return (
    <span className={styles.root} data-tile={tile}>
      {tile === 'theme' && <span className={styles.theme} />}
      {tile === 'material' && <Backdrop src={art} name="art" dim />}
      {tile === 'cover' && <Backdrop src={cover} name="cover" />}
      {tile === 'palette' && <Backdrop src={palette} name="palette" />}
      {tile === 'image' && <Backdrop src={art} name="art" dim />}
      {tile === 'material' ? (
        <span className={styles.window}>
          <Skeleton />
        </span>
      ) : (
        <Skeleton />
      )}
    </span>
  );
}
