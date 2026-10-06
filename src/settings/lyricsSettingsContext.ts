import { createContext, type ReactNode } from 'react';

export const LyricsSettingsContext = createContext<ReactNode>(null);
export const LyricsSettingsNavigationContext = createContext<(() => void) | null>(null);
