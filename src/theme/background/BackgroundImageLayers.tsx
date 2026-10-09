import { useEffect, useState } from 'react';
import { DURATION_MS, motionDuration } from '../../motion/timing.ts';
import styles from './BackgroundImageLayers.module.css';

export function BackgroundImageLayers({
  url,
  reduced,
  onReady,
}: {
  readonly url: string;
  readonly reduced: boolean;
  readonly onReady?: () => void;
}) {
  const [layers, setLayers] = useState({ current: '', previous: '' });
  const currentUrl = layers.current;
  useEffect(() => {
    if (!url) {
      setLayers({ current: '', previous: '' });
      onReady?.();
      return;
    }
    let active = true;
    const image = new Image();
    const failed = () => {
      if (!active) return;
      active = false;
      clearTimeout(timeout);
      setLayers({ current: '', previous: '' });
      onReady?.();
    };
    const timeout = setTimeout(failed, 10_000);
    image.src = url;
    void image.decode().then(() => {
      clearTimeout(timeout);
      if (active) {
        setLayers((old) => ({ current: url, previous: old.current === url ? '' : old.current }));
        onReady?.();
      }
    }, failed);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [url, onReady]);
  useEffect(() => {
    if (!currentUrl) return;
    const timer = setTimeout(
      () => setLayers((current) => ({ ...current, previous: '' })),
      motionDuration(DURATION_MS.faster, reduced),
    );
    return () => clearTimeout(timer);
  }, [currentUrl, reduced]);
  if (!url || !layers.current) return null;
  return (
    <>
      {layers.previous && (
        <img className={styles.image} src={layers.previous} alt="" draggable={false} />
      )}
      <img
        key={layers.current}
        className={`${styles.image} ${styles.enter}`}
        src={layers.current}
        alt=""
        draggable={false}
        data-background-image
      />
    </>
  );
}
