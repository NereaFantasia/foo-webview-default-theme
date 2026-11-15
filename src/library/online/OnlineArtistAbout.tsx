import { RecordRegular, TextNumberListLtr16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { Metadata, MetadataItem } from '../../kit/Metadata.tsx';
import type { MusicArtist } from '../../server/musicObjects.ts';
import { BiographyPanel } from '../biography/BiographyPanel.tsx';
import type { OnlineArtistBiography } from './onlineArtistBiography.ts';
import styles from './OnlineArtistPage.module.css';

/**
 * 在线艺人页的「关于」：简介、曲风与身份确认照本地艺人页，数据来自 Apple 或 Last.fm（来源是设置里的全局项）；
 * 接在后面的一行是平台自报的专辑数与曲数，没给的项不出。简介服务没装配好时只画这一行
 */
export function OnlineArtistAbout({
  owner,
  bio,
}: {
  readonly owner: MusicArtist;
  readonly bio: OnlineArtistBiography | null;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const count = new Intl.NumberFormat(locale);
  const stats = (
    <Metadata>
      {owner.albumCount !== null && (
        <MetadataItem icon={<RecordRegular />} label={t('trackInfo.album')}>
          {t(plural(owner.albumCount, 'onlineList.albumsOne', 'onlineList.albums'), {
            count: count.format(owner.albumCount),
          })}
        </MetadataItem>
      )}
      {owner.trackCount !== null && (
        <MetadataItem icon={<TextNumberListLtr16Regular />}>
          {t(plural(owner.trackCount, 'album.menuTracksOne', 'album.menuTracks'), {
            count: count.format(owner.trackCount),
          })}
        </MetadataItem>
      )}
    </Metadata>
  );
  const hasStats = owner.albumCount !== null || owner.trackCount !== null;
  return (
    <div className={styles.about} data-artist-about>
      {bio ? <AboutPanel bio={bio} /> : <h2 className={styles.heading}>{t('artists.about')}</h2>}
      {hasStats && <div className={styles.facts}>{stats}</div>}
    </div>
  );
}

function AboutPanel({ bio }: { readonly bio: OnlineArtistBiography }) {
  const t = useAtomValueRawSync(translateAtom);
  const subject = useAtomValueRawSync(bio.subject);
  const current = useAtomValueRawSync(bio.current);
  const language = useAtomValueRawSync(bio.language);
  const source = useAtomValueRawSync(bio.sourcePrefs.source);
  // 合辑类的名字与不合格的名字没有键，不联网，只画标题
  if (subject === null) return <h2 className={styles.heading}>{t('artists.about')}</h2>;
  return (
    <BiographyPanel
      layout="about"
      matchSource="platform"
      heading={t('artists.about')}
      artist={subject}
      {...(current ? { name: current.name } : {})}
      language={language}
      service={bio.service}
      identity={bio.identity}
      source={source}
      appleIdentity={bio.appleIdentity}
      sourcePrefs={bio.sourcePrefs}
      prefs={bio.prefs}
      t={t}
      onRefresh={bio.refresh}
      onOpenSettings={bio.openSettings}
    />
  );
}
