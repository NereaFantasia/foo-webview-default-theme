import backdropIsolation from './backdrop-isolation.webp';
import backdropMesh from './backdrop-mesh.webp';
import backdropOff from './backdrop-off.webp';
import backdropTitanium from './backdrop-titanium.webp';
import lyrics from './lyrics.webp';
import paperDark from './paper-dark.webp';
import paperLight from './paper-light.webp';
import styles from './ViewThumbs.module.css';

/** 歌词视图背景类型，取值与偏好一致；此处独立声明以避免缩略图反向依赖背景模块 */
export type BackdropThumbChoice = 'mesh' | 'titanium' | 'isolation' | 'off';

const BACKDROP_SHOTS: Readonly<Record<BackdropThumbChoice, string>> = {
  mesh: backdropMesh,
  titanium: backdropTitanium,
  isolation: backdropIsolation,
  off: backdropOff,
};

/** 界面缩略图；按设置页最大显示宽度的 2 倍提供 380×238 高分屏截图 */
function Shot({ src, name }: { readonly src: string; readonly name: string }) {
  return <img className={styles.shot} src={src} alt="" draggable={false} data-shot={name} />;
}

/** 视图样式缩略图；图纸模式区分明暗主题，歌词视图固定为深色快照 */
export function SceneThumb({
  scene,
  dark,
}: {
  readonly scene: 'paper' | 'presets';
  readonly dark: boolean;
}) {
  if (scene === 'presets') return <Shot src={lyrics} name="lyrics" />;
  return dark ? (
    <Shot src={paperDark} name="paper-dark" />
  ) : (
    <Shot src={paperLight} name="paper-light" />
  );
}

/** 视图背景效果缩略图；以统一封面展示各背景渲染器在无前景干扰下的纯视觉表现 */
export function BackdropThumb({ choice }: { readonly choice: BackdropThumbChoice }) {
  return <Shot src={BACKDROP_SHOTS[choice]} name={`backdrop-${choice}`} />;
}
