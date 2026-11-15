import {
  Button,
  Spinner,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowShuffle20Regular,
  ImageMultiple20Regular,
  MoreHorizontal20Regular,
  Person48Regular,
  Play20Filled,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { CAPSULE_FILTER } from '../../theme/capsuleMaterial.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import { DETAIL_COVER_NARROW, DetailTitle } from './DetailHeader.tsx';
import styles from './ArtistHero.module.css';

const ACTION_HEIGHT = '44px';
/**
 * 起播胶囊外侧圆角，取按钮高度的一半
 *
 * 避免使用 `borderRadiusCircular`（10000px）：同一条边上相邻圆角半径之和超过边长时，
 * CSS 会等比例缩减所有圆角，导致内侧较小的圆角被过度挤压变形
 */
const ACTION_OUTER_RADIUS = '22px';

/**
 * 头部操作胶囊样式：
 * - 起播胶囊由品牌色实底「播放」与半透明同色「随机播放」拼接而成，中间保留间隙且拼接内角采用小圆角
 * - 次要操作（更多、照片）共用半透明胶囊容器，按钮自身保持透明，悬停与按压反馈限制在按钮局部区域
 */
const useStyles = makeStyles({
  start: {
    height: ACTION_HEIGHT,
    minWidth: '112px',
    paddingLeft: tokens.spacingHorizontalXL,
    paddingRight: tokens.spacingHorizontalL,
    columnGap: tokens.spacingHorizontalS,
    fontWeight: tokens.fontWeightSemibold,
    borderTopLeftRadius: ACTION_OUTER_RADIUS,
    borderBottomLeftRadius: ACTION_OUTER_RADIUS,
    borderTopRightRadius: tokens.borderRadiusLarge,
    borderBottomRightRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
  },
  shuffle: {
    height: ACTION_HEIGHT,
    width: '52px',
    minWidth: '52px',
    padding: 0,
    borderTopLeftRadius: tokens.borderRadiusLarge,
    borderBottomLeftRadius: tokens.borderRadiusLarge,
    borderTopRightRadius: ACTION_OUTER_RADIUS,
    borderBottomRightRadius: ACTION_OUTER_RADIUS,
    boxShadow: tokens.shadow2,
    backdropFilter: CAPSULE_FILTER,
    '@media (prefers-reduced-transparency: reduce)': { backdropFilter: 'none' },
    '@media (forced-colors: none)': {
      '&:not(:disabled, [aria-disabled="true"])': {
        backgroundColor: 'color-mix(in oklab, var(--accent) 22%, transparent)',
        color: 'var(--accent)',
        '& .fui-Button__icon': { color: 'var(--accent)' },
        ':hover': {
          backgroundColor: 'color-mix(in oklab, var(--accent) 30%, transparent)',
          color: 'var(--accent)',
          '& .fui-Button__icon': { color: 'var(--accent)' },
        },
        ':active,:hover:active,:active:focus-visible': {
          backgroundColor: 'color-mix(in oklab, var(--accent) 38%, transparent)',
          color: 'var(--accent)',
          '& .fui-Button__icon': { color: 'var(--accent)' },
        },
      },
    },
  },
  // 次要按键半透明胶囊：前景色与透明度混合并叠加毛玻璃模糊；系统开启减弱透明度时回退至近实色且不模糊
  glass: {
    display: 'flex',
    alignItems: 'center',
    height: ACTION_HEIGHT,
    paddingLeft: tokens.spacingHorizontalXXS,
    paddingRight: tokens.spacingHorizontalXXS,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: `color-mix(in oklab, ${tokens.colorNeutralForeground1} 10%, transparent)`,
    backdropFilter: CAPSULE_FILTER,
    boxShadow: tokens.shadow2,
    '@media (prefers-reduced-transparency: reduce)': {
      backgroundColor: `color-mix(in oklab, ${tokens.colorNeutralForeground1} 10%, ${tokens.colorNeutralBackground1})`,
      backdropFilter: 'none',
    },
  },
  round: { width: '40px', height: '40px', minWidth: '40px', padding: 0 },
});

/** 常规宽度下的圆形头像直径（CSS 像素）；窄屏时与专辑详情页保持一致缩至 96px */
const AVATAR = 240;

/** 艺术字图片信息：包含图片地址与用于占位排版的原始宽高 */
export interface ArtistHeroLogo {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

export interface ArtistHeroProps {
  readonly name: string;
  /** 艺术字图片配置：深色方案且加载成功时代替文本艺人名（文本名仍在 DOM 中）；浅色方案或加载失败时回退至文本艺人名 */
  readonly logo?: ArtistHeroLogo;
  readonly narrow: boolean;
  /** 完成宽高比测量且已就绪的头像；测量中或加载失败时为 undefined */
  readonly shown?: { readonly url: string; readonly shape: 'round' | 'rect' };
  /** 头部宽幅图已就绪标记：开启时隐藏圆形头像，由外框背景层统一绘制图像 */
  readonly wide: boolean;
  /** 照片检索中标记：头像区域展示加载动画 */
  readonly loading: boolean;
  /** 存在可用照片：头像与照片按钮允许交互 */
  readonly canOpenPhotos: boolean;
  /** 照片查看按钮点击回调；未传入则不展示按钮 */
  readonly onOpenPhotos?: () => void;
  /** 照片数据源拉取中状态：按钮内展示加载旋转指示器，加载期间若已有照片仍允许点击浏览 */
  readonly photosLoading?: boolean;
  readonly playable: boolean;
  readonly onPlay: () => void;
  readonly onShuffle: () => void;
  readonly onMenu: (x: number, y: number) => void;
  /** 起播按钮的文案与图标；默认为「播放」 */
  readonly playLabel?: string;
  readonly playIcon?: ReactElement;
  /** 次要胶囊内位于「更多」按钮左侧的附加内容 */
  readonly extra?: ReactNode;
  /** 未检索到照片且未处于加载中时的占位内容，默认为人形图标 */
  readonly placeholder?: ReactNode;
  /** 挂载在头部容器内的覆盖层，例如照片查看器 */
  readonly children?: ReactNode;
}

/**
 * 艺人页头部区域：
 * - 铺满内容卡片，左下角沉底展示艺人名与操作胶囊按键，统计与合作艺人归入下方的关于区域
 * - 右下角默认展示圆形头像并向内预留间距；照片检索中展示加载指示器；照片测量宽高比后，方形照片在头像内淡入，非方形照片渲染为扩展横幅且头像淡出保留占位；检索完毕无照片、失败或合辑时展示占位图标
 * - 存在宽幅艺术照时铺满头部背景，隐藏圆形头像；背景图由外框层（`ArtistHeroImage`）绘制，本组件负责高度计算与交互区域让位
 */
export function ArtistHero(props: ArtistHeroProps) {
  const { name, narrow, shown, wide, loading, canOpenPhotos, onOpenPhotos } = props;
  const controls = useViewControlStyles();
  const local = useStyles();
  const t = useAtomValueRawSync(translateAtom);
  // 数据源拉取期间按钮展示旋转加载，完成后恢复图标；已有照片时支持随时点击查看
  const photosPending = !!props.photosLoading;
  const photosLabel = t(photosPending && !canOpenPhotos ? 'artists.loading' : 'biography.photos');
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  // 图片加载成功后才展示艺术字；加载中、失败或浅色模式下均渲染文本艺人名，避免白屏闪烁
  const [loadedLogo, setLoadedLogo] = useState<string | null>(null);
  const logo = props.logo;
  const useLogo = !!logo && scheme === 'dark';
  const logoShown = useLogo && loadedLogo === logo.src;
  // 宽幅艺术照铺满头部且不展示圆形头像；非方形照片转为扩展横幅且圆形头像淡出保留占位；方形照片展示于圆形头像中
  const banner = !wide && shown?.shape === 'rect';
  const size = narrow ? DETAIL_COVER_NARROW : AVATAR;
  const state = shown || wide ? 'ready' : loading ? 'loading' : 'empty';
  return (
    <div
      className={styles.hero}
      style={{ '--artist-avatar': `${size}px` } as CSSProperties}
      data-artist-header
      data-shape={wide ? 'wide' : banner ? 'rect' : 'round'}
      data-narrow={narrow || undefined}
    >
      {banner && shown && (
        <span className={styles.media} aria-hidden>
          <img className={styles.backdrop} src={shown.url} alt="" draggable={false} />
          <img
            className={styles.contained}
            src={shown.url}
            alt=""
            draggable={false}
            data-artist-photo-foreground
          />
        </span>
      )}
      <button
        type="button"
        className={styles.avatar}
        style={{ width: size, height: size }}
        disabled={!canOpenPhotos}
        inert={banner || wide}
        data-away={banner || wide || undefined}
        aria-label={t('biography.openPhotos')}
        data-artist-photo-state={state}
        onClick={onOpenPhotos}
      >
        {loading
          ? !shown && !wide && <Spinner size="small" aria-label={t('artists.loading')} />
          : (props.placeholder ?? <Person48Regular className={styles.placeholder} />)}
        {!wide && shown?.shape === 'round' && (
          <img
            key={shown.url}
            className={styles.photo}
            src={shown.url}
            alt={name}
            draggable={false}
            data-artist-photo-foreground
          />
        )}
      </button>
      <div className={styles.identity}>
        {useLogo && (
          <img
            key={logo.src}
            className={styles.logo}
            src={logo.src}
            alt={name}
            width={logo.width}
            height={logo.height}
            draggable={false}
            hidden={!logoShown}
            data-artist-logo={logoShown ? 'shown' : 'loading'}
            onLoad={() => setLoadedLogo(logo.src)}
            onError={() => setLoadedLogo(null)}
          />
        )}
        {/* 文本艺人名保留在 DOM 中供搜索与无障碍读取；展示艺术字时通过 aria-hidden 避免屏幕阅读器重复朗读 */}
        <div
          className={logoShown ? styles.nameHidden : undefined}
          aria-hidden={logoShown || undefined}
        >
          <DetailTitle name={name} />
        </div>
        <div className={styles.actions}>
          <div className={styles.split}>
            <PrimaryPlayButton
              className={local.start}
              icon={props.playIcon ?? <Play20Filled />}
              disabled={!props.playable}
              onClick={props.onPlay}
            >
              {props.playLabel ?? t('artists.play')}
            </PrimaryPlayButton>
            <Tooltip content={t('artists.shuffle')} relationship="label">
              <Button
                appearance="subtle"
                className={local.shuffle}
                icon={<ArrowShuffle20Regular />}
                aria-label={t('artists.shuffle')}
                disabled={!props.playable}
                onClick={props.onShuffle}
              />
            </Tooltip>
          </div>
          <div className={local.glass}>
            {props.extra}
            <Tooltip content={t('artists.more')} relationship="label">
              <Button
                appearance="transparent"
                shape="circular"
                className={mergeClasses(controls.icon, local.round)}
                icon={<MoreHorizontal20Regular />}
                aria-label={t('artists.more')}
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  props.onMenu(box.left, box.bottom);
                }}
              />
            </Tooltip>
            {onOpenPhotos && (
              <Tooltip content={photosLabel} relationship="label">
                <Button
                  appearance="transparent"
                  shape="circular"
                  className={mergeClasses(controls.icon, local.round)}
                  icon={
                    photosPending ? <Spinner size="tiny" aria-hidden /> : <ImageMultiple20Regular />
                  }
                  aria-label={photosLabel}
                  disabled={!canOpenPhotos}
                  aria-busy={photosPending || undefined}
                  data-artist-photos={photosPending ? 'loading' : canOpenPhotos ? 'ready' : 'empty'}
                  onClick={onOpenPhotos}
                />
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      {props.children}
    </div>
  );
}

/** `DetailHeader` 骨架之外次要胶囊中图标按钮的尺寸类名 */
export function useHeroButtonClass(): string {
  return useStyles().round;
}
