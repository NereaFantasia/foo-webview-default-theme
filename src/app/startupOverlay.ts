// 宿主见到这个 id 就先不显示窗口，它不在了才显示。
const HOST_SIGNAL_ID = 'server-loading';
// 与 index.html 里淡出的时长一致。
const FADE_MS = 150;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let markHidden = () => {};
const hiddenOnce = new Promise<void>((resolve) => {
  markHidden = resolve;
});

function find(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.startup-overlay');
}

/**
 * 启动等待层写在 index.html 里，页面第一帧就有，不等脚本。收起时先摘掉 id，让宿主立刻显示窗口，
 * 再淡出隐藏；元素留在页面里，重新检查窗口模式时还能盖回来。
 */
export const startupOverlay = {
  /** 盖上等待层，换成当前在等的步骤。 */
  show(stage: string): void {
    const overlay = find();
    if (!overlay) return;
    clearTimeout(hideTimer);
    overlay.id = HOST_SIGNAL_ID;
    delete overlay.dataset.leaving;
    overlay.removeAttribute('aria-hidden');
    overlay.hidden = false;
    const text = overlay.querySelector('.startup-stage');
    if (text) text.textContent = stage;
  },
  /** 收起等待层；已经收起或正在淡出时什么也不做。 */
  dismiss(): void {
    const overlay = find();
    if (!overlay || overlay.hidden) markHidden();
    if (!overlay || overlay.hidden || overlay.dataset.leaving !== undefined) return;
    overlay.removeAttribute('id');
    overlay.dataset.leaving = '';
    // 淡出期间它已不算启动状态，读屏不再播报。
    overlay.setAttribute('aria-hidden', 'true');
    hideTimer = setTimeout(() => {
      overlay.hidden = true;
      markHidden();
    }, FADE_MS);
  },
  /**
   * 等待层第一次淡出完时兑现，之后再盖回来也不重置；页面里没有等待层时立即兑现。
   * 新人引导这类开场就弹的对话框等它，入场动效才不会被等待层盖住。
   */
  hidden(): Promise<void> {
    if (!find()) markHidden();
    return hiddenOnce;
  },
};
