import { useViewServices } from '../page/viewServices.ts';
import { usePerfSampler } from './usePerfSampler.ts';
import styles from './PerfOverlay.module.css';

/**
 * 性能小窗：贴在沉浸视图左上角、拖窗条下方，开着（`perfOverlayEnabledAtom`，Ctrl+Shift+P 经命令登记处切换）
 * 才出、才采样。不接指针，不挡下面的 seek；不随控件层隐藏，开着就一直在。字是技术缩写，与图纸字段名一样
 * 两种语言都不翻；读屏不读，数字每 0.5 s 变一次。
 */
export function PerfOverlay() {
  const { spectrum } = useViewServices();
  const lines = usePerfSampler(spectrum);
  if (lines.length === 0) return null;
  return (
    <div className={styles.overlay} aria-hidden>
      {lines.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}
