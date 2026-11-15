import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { appleLogoUrl } from '../../biography/apple/appleMedia.ts';
import { BiographyPhotoViewer } from '../../biography/BiographyPhotoViewer.tsx';
import { ArtistHero } from '../../detail/ArtistHero.tsx';
import { useArtists } from '../artistsContext.ts';
import { ArtistPhotoTools } from '../photos/ArtistPhotoTools.tsx';
import { useArtistPortrait } from './useArtistPortrait.ts';

/**
 * 头像等照片的最长时间，毫秒。照片还在找或在量宽高比时头像转圈，不先露占位再换成照片，更不先画成圆形再换成横幅；
 * 超过这个时间还没有结果就不再转圈，露人像占位，照片晚到了再淡入
 */
const LOADING_MAX_MS = 10_000;

/**
 * 本地艺人页的头部：把这位艺人的照片、可播放与否与回调喂给 `ArtistHero`。照片取「设为头像」的那张，没设取第一张；
 * 合辑不用照片。点头像或「照片」键打开 `BiographyPhotoViewer`
 */
export function ArtistHeader({
  narrow,
  onMenu,
}: {
  readonly narrow: boolean;
  readonly onMenu: (x: number, y: number) => void;
}) {
  const services = useArtists();
  const name = useAtomValueRawSync(services.places.selected);
  const state = useAtomValueRawSync(services.detail.state);
  const compilation = useAtomValueRawSync(services.compilation);
  const logo = useAtomValueRawSync(services.biography.logo);
  const viewerTop = useAtomValueRawSync(services.biography.viewerTop);
  const t = useAtomValueRawSync(translateAtom);
  const {
    pictures,
    portrait,
    chosen: preferred,
    shown,
    wide,
    searching,
    measuring,
  } = useArtistPortrait();
  const [viewing, setViewing] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [grace, setGrace] = useState(true);
  // 换一位艺人重新计时：头部留在页面上时，第二位也要有加载态
  useEffect(() => {
    setGrace(true);
    const timer = setTimeout(() => setGrace(false), LOADING_MAX_MS);
    return () => clearTimeout(timer);
  }, [name]);
  const index = Math.max(
    0,
    pictures.findIndex((photo) => photo.key === (chosen ?? preferred)),
  );
  const photo = pictures[index];
  const openPhotos = () => {
    setChosen(portrait?.key ?? null);
    setViewing(true);
  };
  const detail = state.subject === name ? state.detail : null;
  const playable =
    !!detail &&
    detail.summary.tracks > 0 &&
    !state.partial &&
    !state.refreshFailed &&
    !state.guestPending;
  return (
    <ArtistHero
      name={name || t('artists.unknown')}
      {...(logo
        ? { logo: { src: appleLogoUrl(logo), width: logo.width, height: logo.height } }
        : {})}
      narrow={narrow}
      {...(shown ? { shown: { url: shown.photo.url, shape: shown.shape } } : {})}
      wide={wide}
      loading={grace && (searching || measuring)}
      canOpenPhotos={!!photo}
      photosLoading={grace && searching}
      {...(compilation ? {} : { onOpenPhotos: openPhotos })}
      playable={playable}
      onPlay={() => void services.play()}
      onShuffle={() => void services.play(0, true)}
      onMenu={onMenu}
    >
      {photo && (
        <BiographyPhotoViewer
          open={viewing}
          artist={name ?? ''}
          photos={pictures}
          index={index}
          top={viewerTop}
          t={t}
          commandPrefix="artists"
          actions={<ArtistPhotoTools artist={name ?? ''} photo={photo.key} />}
          onSelect={(at) => setChosen(pictures[at]?.key ?? null)}
          onClose={() => setViewing(false)}
        />
      )}
    </ArtistHero>
  );
}
