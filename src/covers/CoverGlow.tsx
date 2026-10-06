import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useState, type Ref } from 'react';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import { CoverVisualContext } from './CoverTheme.tsx';
import styles from './CoverGlow.module.css';

function GlowImage({ url }: { readonly url: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  if (state === 'failed') return null;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className={styles.image}
      data-ready={state === 'ready' || undefined}
      onLoad={() => setState('ready')}
      onError={() => setState('failed')}
    />
  );
}

export function CoverGlow({
  className = '',
  ref,
}: {
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}) {
  const { url } = useContext(CoverVisualContext);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  return (
    <div
      ref={ref}
      className={`${styles.root} ${className}`}
      data-scheme={scheme}
      data-cover-glow
      aria-hidden="true"
    >
      <div className={styles.bloom}>{url && <GlowImage key={url} url={url} />}</div>
      <div className={styles.grain} />
    </div>
  );
}
