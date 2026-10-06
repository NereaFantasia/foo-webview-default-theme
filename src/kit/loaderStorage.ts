const ATTEMPTS_KEY = 'default-theme.update.v1';

/** 只访问引导页的运行状态；业务偏好不能使用这组不记代数的接口。 */
export interface LoaderStorage {
  readAttempts(): string | null;
  writeAttempts(value: string): void;
  readCookie(name: string): string | null;
  writeCookie(name: string, value: string): void;
  lock<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export function browserLoaderStorage(): LoaderStorage {
  return {
    readAttempts: () => localStorage.getItem(ATTEMPTS_KEY),
    writeAttempts(value) {
      localStorage.setItem(ATTEMPTS_KEY, value);
      if (localStorage.getItem(ATTEMPTS_KEY) !== value) throw new Error('无法保存启动计数');
    },
    readCookie(name) {
      const item = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
      try {
        return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
      } catch {
        return null;
      }
    },
    writeCookie(name, value) {
      document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`;
      if (this.readCookie(name) !== value) throw new Error('无法保存启动会话');
    },
    async lock(work, signal) {
      if (!navigator.locks) throw new Error('缺少共享写锁');
      return await navigator.locks.request('default-theme.boot.v1', { signal }, work);
    },
  };
}
