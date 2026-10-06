import { createContext, type ReactNode } from 'react';

export const OnlineSettingsContext = createContext<ReactNode>(null);
export const OnlineSettingsNavigationContext = createContext<(() => void) | null>(null);
