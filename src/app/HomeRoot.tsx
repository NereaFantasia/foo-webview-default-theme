import { useEffect, useState, type ReactNode } from 'react';
import { useService } from '../kit/useService.ts';
import { musicClientKey } from '../playback/musicClient.ts';
import { musicStatusKey } from '../playback/musicStatus.ts';
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
  const client = useService(musicClientKey);
  const status = useService(musicStatusKey);
  useEffect(() => {
    const next = startHomeIntegration(services, { client, status });
    setHome(next);
    return () => next.dispose();
  }, [services, client, status]);
  return <HomeContext value={home}>{children}</HomeContext>;
}
