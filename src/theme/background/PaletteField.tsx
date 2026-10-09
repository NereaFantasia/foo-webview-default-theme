import { useEffect, useRef } from 'react';
import { useService } from '../../kit/useService.ts';
import { flowingFieldKey } from './flowingField.ts';
import styles from './PaletteField.module.css';

export function PaletteField({ onReady }: { readonly onReady: () => void }) {
  const target = useRef<HTMLDivElement>(null);
  const service = useService(flowingFieldKey);
  useEffect(() => {
    if (target.current) return service.attach(target.current, onReady);
  }, [service, onReady]);
  return <div ref={target} className={styles.root} aria-hidden="true" />;
}
