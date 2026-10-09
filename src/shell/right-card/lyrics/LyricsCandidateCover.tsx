import { RecordRegular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useService } from '../../../kit/useService.ts';
import { lyricsKey } from '../../../lyrics/lyricsService.ts';
import { lyricsCoverKey, type LyricsCoverTarget } from '../../../lyrics/lyricsCandidateCovers.ts';
import styles from './LyricsCandidateCover.module.css';

interface LyricsCandidateCoverProps {
  readonly candidate: LyricsCoverTarget;
  readonly enabled: boolean;
  readonly viewport: RefObject<HTMLElement | null>;
  readonly className: string;
}

export function LyricsCandidateCover({
  candidate,
  enabled,
  viewport,
  className,
}: LyricsCandidateCoverProps) {
  const { covers } = useService(lyricsKey);
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState('');
  const { source, ref, coverUrl } = candidate;
  const target = useMemo(() => ({ source, ref, coverUrl }), [source, ref, coverUrl]);
  const key = lyricsCoverKey(target);
  const image = useMemo(() => atom((get) => get(covers.state).get(key) ?? ''), [covers, key]);
  const url = useAtomValueRawSync(image);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      {
        root: viewport.current,
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);
  useLayoutEffect(() => {
    if (visible && enabled) return covers.acquire(target);
  }, [covers, target, visible, enabled]);
  const src = visible && url !== failed ? url : '';
  return (
    <div ref={root} className={`${styles.root} ${className}`} aria-hidden>
      {src ? (
        <img src={src} alt="" decoding="async" draggable={false} onError={() => setFailed(src)} />
      ) : (
        <RecordRegular className={styles.placeholder} />
      )}
    </div>
  );
}
