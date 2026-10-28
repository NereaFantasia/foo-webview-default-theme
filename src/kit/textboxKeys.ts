/**
 * 嵌入容器导航区域内的文本框键盘属性配置（如重命名框、搜索框）
 * 防止方向键、Home、End 与翻页键触发外层容器（基于 Tabster）的网格或列表键盘导航，确保光标正常移动
 * 格式遵循 Tabster 的 `data-tabster` 属性规范中 `focusable.ignoreKeydown` 的结构要求
 */
export const TEXTBOX_KEYS = {
  'data-tabster': JSON.stringify({
    focusable: {
      ignoreKeydown: {
        ArrowUp: true,
        ArrowDown: true,
        ArrowLeft: true,
        ArrowRight: true,
        Home: true,
        End: true,
        PageUp: true,
        PageDown: true,
      },
    },
  }),
};
