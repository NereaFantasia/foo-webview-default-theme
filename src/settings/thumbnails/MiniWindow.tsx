import { useId } from 'react';
import type { PlayerBarStyle } from '../../theme/playerBarStyle.ts';
import styles from './MiniWindow.module.css';

type Tone = 'hard' | 'mid' | 'soft' | 'accent' | 'field' | 'elevated';

interface BlockProps {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly tone: Tone;
  readonly r?: number;
}

/** 缩略图通用圆角矩形色块，示意文本、图标与控件 */
function Block({ x, y, w, h, tone, r = h / 2 }: BlockProps) {
  return <rect x={x} y={y} width={w} height={h} rx={r} className={styles[tone]} />;
}

function Dot({ x, y, r, tone }: { x: number; y: number; r: number; tone: Tone }) {
  return <circle cx={x} cy={y} r={r} className={styles[tone]} />;
}

function Transport({
  x,
  y,
  big,
}: {
  readonly x: number;
  readonly y: number;
  readonly big: number;
}) {
  return (
    <>
      <Dot x={x - 96} y={y} r={9} tone="mid" />
      <Dot x={x - 52} y={y} r={9} tone="hard" />
      <Dot x={x} y={y} r={big / 2} tone="accent" />
      <Dot x={x + 52} y={y} r={9} tone="hard" />
    </>
  );
}

function Sidebar() {
  const rows = Array.from({ length: 6 }, (_, index) => 184 + index * 40);
  return (
    <>
      <Block x={12} y={56} w={236} h={34} r={6} tone="field" />
      <circle cx={31} cy={72} r={6} className={styles.stroke} />
      <Block x={50} y={69} w={64} h={6} tone="soft" />
      <Block x={26} y={106} w={20} h={20} r={5} tone="mid" />
      <Block x={58} y={111} w={56} h={11} tone="mid" />
      <Block x={26} y={156} w={72} h={9} tone="soft" />
      {rows.map((y, index) => (
        <g key={y}>
          {index === 2 && <Block x={8} y={y - 4} w={240} h={34} r={6} tone="field" />}
          {index === 2 && <Block x={8} y={y + 6} w={3} h={14} tone="accent" />}
          <Block x={26} y={y} w={20} h={20} r={5} tone={index === 2 ? 'hard' : 'mid'} />
          <Block
            x={58}
            y={y + 5}
            w={52 + ((index * 23) % 48)}
            h={11}
            tone={index === 2 ? 'hard' : 'mid'}
          />
        </g>
      ))}
      <Block x={26} y={440} w={84} h={9} tone="soft" />
      {[0, 1, 2].map((index) => (
        <g key={index}>
          <Block x={26} y={468 + index * 38} w={18} h={18} r={4} tone="soft" />
          <Block x={58} y={472 + index * 38} w={86 + index * 22} h={10} tone="soft" />
        </g>
      ))}
    </>
  );
}

/** 专辑网格骨架示意层 */
function Albums() {
  return (
    <>
      <Block x={304} y={84} w={116} h={36} r={8} tone="hard" />
      <Block x={432} y={98} w={56} h={14} tone="soft" />
      <Block x={304} y={140} w={88} h={34} r={8} tone="field" />
      <Block x={402} y={140} w={280} h={34} r={8} tone="field" />
      <Block x={692} y={140} w={120} h={34} r={8} tone="field" />
      <Block x={822} y={140} w={144} h={34} r={8} tone="field" />
      {Array.from({ length: 8 }, (_, index) => {
        const x = 304 + (index % 4) * 238;
        const y = 196 + Math.floor(index / 4) * 296;
        return (
          <g key={index}>
            <Block x={x} y={y} w={200} h={200} r={10} tone="soft" />
            <Block x={x} y={y + 214} w={150} h={13} tone="hard" />
            <Block x={x} y={y + 238} w={100} h={11} tone="soft" />
          </g>
        );
      })}
    </>
  );
}

function PlayerBar({ bar }: { readonly bar: PlayerBarStyle }) {
  if (bar === 'bottom') {
    return (
      <>
        <Block x={60} y={716} w={1160} h={4} tone="soft" />
        <Block x={60} y={716} w={330} h={4} tone="accent" />
        <Block x={24} y={734} w={56} h={56} r={6} tone="mid" />
        <Block x={96} y={742} w={150} h={14} tone="hard" />
        <Block x={96} y={766} w={110} h={11} tone="soft" />
        <Transport x={640} y={762} big={50} />
        <Dot x={1030} y={762} r={9} tone="mid" />
        <Block x={1060} y={760} w={110} h={4} tone="soft" />
        <Block x={1060} y={760} w={70} h={4} tone="hard" />
      </>
    );
  }
  if (bar === 'titlebar') {
    return (
      <>
        {[100, 140, 184, 226].map((x) => (
          <Dot key={x} x={x} y={24} r={9} tone="mid" />
        ))}
        <Block x={380} y={5} w={520} h={46} r={8} tone="elevated" />
        <Block x={381} y={6} w={44} h={44} r={7} tone="mid" />
        <Block x={438} y={13} w={150} h={12} tone="hard" />
        <Block x={438} y={32} w={120} h={10} tone="soft" />
        <Block x={432} y={46} w={462} h={3} tone="soft" />
        <Block x={432} y={46} w={150} h={3} tone="accent" />
      </>
    );
  }
  return (
    <>
      <Block x={290} y={700} w={940} h={76} r={38} tone="elevated" />
      <Block x={306} y={714} w={48} h={48} r={24} tone="mid" />
      <Block x={368} y={722} w={150} h={14} tone="hard" />
      <Block x={368} y={746} w={110} h={11} tone="soft" />
      <Transport x={780} y={738} big={44} />
      <Dot x={1090} y={738} r={9} tone="mid" />
      <Dot x={1140} y={738} r={9} tone="soft" />
      <Block x={330} y={768} w={860} h={3} tone="soft" />
      <Block x={330} y={768} w={250} h={3} tone="accent" />
    </>
  );
}

/**
 * 主界面微缩视图，以 1280×800 标准版式等比缩放呈现侧边栏、网格与播放栏
 *
 * 文本与图标抽象为中性及强调色色块，自适应当前深浅配色
 */
export function MiniWindow({ bar }: { readonly bar: PlayerBarStyle }) {
  const key = useId().replace(/[^\w-]/g, '');
  const cardHeight = bar === 'bottom' ? 640 : 736;
  return (
    <svg
      className={styles.root}
      viewBox="0 0 1280 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
    >
      <defs>
        <clipPath id={`${key}-card`}>
          <rect x={268} y={52} width={996} height={cardHeight} rx={12} />
        </clipPath>
      </defs>
      <rect width={1280} height={800} className={styles.window} />
      <Dot x={26} y={26} r={3} tone="mid" />
      <Dot x={40} y={26} r={3} tone="mid" />
      <Dot x={54} y={26} r={3} tone="mid" />
      {bar !== 'titlebar' && (
        <>
          <path d="M108 18l-6 8 6 8M148 18l6 8-6 8" className={styles.stroke} />
          <rect x={222} y={16} width={18} height={16} rx={3} className={styles.stroke} />
        </>
      )}
      <Block x={1166} y={25} w={16} h={2} tone="mid" />
      <rect x={1208} y={17} width={14} height={14} rx={2} className={styles.stroke} />
      <path d="M1246 17l14 14M1260 17l-14 14" className={styles.stroke} />
      <Sidebar />
      <rect x={268} y={52} width={996} height={cardHeight} rx={12} className={styles.pane} />
      <g clipPath={`url(#${key}-card)`}>
        <Albums />
      </g>
      <PlayerBar bar={bar} />
    </svg>
  );
}
