/**
 * 放在侧边栏里的文本框上（改名框、筛选框）：侧边栏的方向键导航不接这几个键，方向键、Home、End、
 * 翻页留给文本框自己移光标，不把焦点带走。Fluent 的方向键导航是 tabster 做的，它从焦点所在元素往上
 * 读 `data-tabster` 的 `focusable.ignoreKeydown`，这里按它的格式写。
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
