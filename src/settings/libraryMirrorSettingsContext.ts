import { createContext, type ReactNode } from 'react';

/** 「常规」里的媒体库缓存卡：卡片由装配层放进来，设置页不认识媒体库镜像 */
export const LibraryMirrorSettingsContext = createContext<ReactNode>(null);
