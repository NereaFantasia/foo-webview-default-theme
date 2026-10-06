import type { ReactNode } from 'react';
import { SearchContext } from './searchContext.ts';
import { SearchFlyout } from './SearchFlyout.tsx';
import { useSearchController } from './useSearchController.ts';

export function SearchRoot({ children }: { readonly children: ReactNode }) {
  const session = useSearchController();
  return (
    <SearchContext value={session}>
      {children}
      <SearchFlyout />
    </SearchContext>
  );
}
