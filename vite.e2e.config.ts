import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.ts';

// e2e 专用的开发服务器：跑测试期间一改源码，监听文件的服务器就会把正在跑的页面整页重载，用例成片超时。
// 这里关掉热更新与文件监听，模块按首次请求时的源码编译并缓存到服务退出；
// playwright.config.ts 每次跑都新起一个服务，所以每轮拿到的是开跑时的源码。
export default mergeConfig(
  base,
  defineConfig({ server: { hmr: false, watch: { ignored: ['**/*'] } } }),
);
