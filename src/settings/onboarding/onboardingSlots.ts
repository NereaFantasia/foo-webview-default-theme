import { createContext, type ReactNode } from 'react';

/** 第 4 步的更新方式与主题更新卡：由装配层放进来，引导不认识更新服务。 */
export const OnboardingUpdateContext = createContext<ReactNode>(null);

/** 第 4 步的在线艺人简介开关：由装配层放进来，引导不认识简介服务。 */
export const OnboardingOnlineContext = createContext<ReactNode>(null);
