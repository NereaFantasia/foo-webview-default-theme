import { useAtomValueRawSync } from 'jotai/react';
import { currentTrackAtom } from '../../playback/playback.ts';
import { MISSING, formatChannels, formatKHz, formatKbps, formatMB } from '../paper/paperScale.ts';
import { trackExtrasAtom } from './trackExtras.ts';
import styles from './PaperFileInfo.module.css';

/** 图纸右栏的文件信息 3 × 2：采样率、位深、声道、码率、文件大小、格式；缺值写 `—`。 */
export function PaperFileInfo() {
  const track = useAtomValueRawSync(currentTrackAtom);
  const { bitDepth } = useAtomValueRawSync(trackExtrasAtom);
  const items = [
    { id: 'sampleRate', key: 'Sample rate', value: formatKHz(track?.sampleRate) },
    { id: 'bitDepth', key: 'Bit depth', value: bitDepth || MISSING },
    { id: 'channels', key: 'Channels', value: formatChannels(track?.channels) },
    { id: 'bitrate', key: 'Bitrate', value: formatKbps(track?.bitrate) },
    { id: 'fileSize', key: 'File size', value: formatMB(track?.fileSize) },
    { id: 'format', key: 'Format', value: track?.codec || MISSING },
  ];
  return (
    <dl className={styles['file-info']}>
      {items.map((item) => (
        <div key={item.id} className={styles.field}>
          <dt className={styles.key}>{item.key}</dt>
          <dd className={styles.value} data-field={item.id}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
