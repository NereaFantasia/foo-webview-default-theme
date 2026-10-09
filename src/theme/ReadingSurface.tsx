import styles from './ReadingSurface.module.css';

/** 边缘先取得窗口背景，填充随后绘制；两者互为同级，避免磨砂底截断边缘的背景取样。 */
export function ReadingSurface() {
  return (
    <div className={styles.root} data-reading-surface aria-hidden="true">
      <div className={styles.edge} data-reading-edge />
      <div className={styles.fill} data-reading-fill />
    </div>
  );
}
