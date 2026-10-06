import { createContext, type ReactNode } from 'react';

/** 「关于」里的更新设置：卡片由装配层放进来，设置页不认识更新服务。 */
export const UpdateSettingsContext = createContext<ReactNode>(null);
