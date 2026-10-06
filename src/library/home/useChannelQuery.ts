import { useEffect, useState } from 'react';
import type { ChannelQueryService } from './channelQuery.ts';
import { useHomeServices } from './homeContext.ts';

export function useChannelQuery(preview = false) {
  const home = useHomeServices();
  const [service, setService] = useState<ChannelQueryService | null>(null);
  useEffect(() => {
    const next = home.createQuery(preview);
    setService(next);
    return () => next.dispose();
  }, [home, preview]);
  return service;
}
