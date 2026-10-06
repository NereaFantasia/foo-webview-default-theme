export function createBiographyRequestPool<T, K = string>() {
  const requests = new Map<K, Promise<T>>();
  return {
    run(key: K, fetch: () => Promise<T>): Promise<T> {
      const pending = requests.get(key);
      if (pending) return pending;
      const next = fetch().finally(() => {
        if (requests.get(key) === next) requests.delete(key);
      });
      requests.set(key, next);
      return next;
    },
    clear() {
      requests.clear();
    },
  };
}
