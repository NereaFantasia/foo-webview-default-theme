import { useEffect, useState, type ReactNode } from 'react';
import type { AppServices } from './services.ts';
import { HomeContext, type HomeServices } from '../library/home/homeContext.ts';
import { startHomeIntegration } from './homeIntegration.ts';

export function HomeRoot({
  services,
  children,
}: {
  readonly services: AppServices;
  readonly children: ReactNode;
}) {
  const [home, setHome] = useState<HomeServices | null>(null);
  useEffect(() => {
    const next = startHomeIntegration(services);
    setHome(next);
    return () => next.dispose();
  }, [services]);
  return <HomeContext value={home}>{children}</HomeContext>;
}
