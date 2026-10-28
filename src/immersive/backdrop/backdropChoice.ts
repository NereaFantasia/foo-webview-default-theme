/** 背景渲染器标识符列表；作为持久化契约不变更已发布键名 */
export const BACKDROP_RENDERER_IDS = ['titanium', 'mesh', 'isolation'] as const;
export type BackdropRendererId = (typeof BACKDROP_RENDERER_IDS)[number];

/** 背景效果选项；支持选择具体渲染器或 off 纯底色模式，跨预设共享 */
export const BACKDROP_CHOICES = [...BACKDROP_RENDERER_IDS, 'off'] as const;
export type BackdropChoice = (typeof BACKDROP_CHOICES)[number];

/**
 * 解析当前可用的背景渲染器
 *
 * 优先选用目标渲染器，若当前环境不支持或曾初始化失败则按降级顺序候补；选项为 off 或全不可用时返回 null 以纯色兜底
 */
export function resolveBackdrop(
  choice: BackdropChoice,
  usable: (id: BackdropRendererId) => boolean,
): BackdropRendererId | null {
  if (choice === 'off') return null;
  const order = [choice, ...BACKDROP_RENDERER_IDS.filter((id) => id !== choice)];
  return order.find(usable) ?? null;
}
