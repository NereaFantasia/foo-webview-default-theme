import type { createStore } from 'jotai/vanilla';

/** 整页只有一个 Jotai store：服务把状态写进它，组件经 jotai 的 `Provider` 从同一份里读。 */
export type Store = ReturnType<typeof createStore>;
