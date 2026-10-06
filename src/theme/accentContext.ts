import { createContext } from 'react';
import type { CoverTone } from './coverPalette.ts';

/** 局部内容可覆盖强调色原色，未覆盖时使用全局来源。 */
export const AccentContext = createContext<CoverTone | null>(null);
