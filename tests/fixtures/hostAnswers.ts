import type {
  ApiErrorCode,
  ApiFailure,
  ConfigOutputDevice,
  OutputGetEntriesSuccess,
  PlaylistInfo,
} from 'foo-webview-sdk';
import type { AnswerTable, HostParams, HostResponse } from './fakeHost.ts';

// 缺省应答描述一台空闲的宿主：什么也没在放，媒体库已启用但是空的，只有一张空的 Default 列表，
// profile 里没有外部语言包目录，输出走 DirectSound 的主声卡驱动。
// 每条都按声明填全字段、不做类型断言：宿主声明新增必填字段、或删掉这里写到的字段时编译失败，
// 提醒替身跟着改。

/** config 里存的值的类型，取自 `config.get` 的应答。 */
export type ConfigValue = Extract<HostResponse<'config.get'>, { success: true }>['value'];

/** 缺省应答报的组件版本，与 package.json 的 hostRequirements 下限一致。 */
export const HOST_VERSION = '2.0.0';

/**
 * 一像素透明 PNG。普通浏览器打不开宿主的 fb2k:// 地址，缺省的封面地址换成它，`<img>` 才能真的加载完。
 */
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** 宿主的失败信封。所有方法的应答都接受它，调用方拿到的是 resolve 的值。 */
export function hostFailure(code: ApiErrorCode, error: string = code): ApiFailure {
  return { success: false, error, code };
}

/**
 * 宿主不认这个方法时注入脚本 reject 的错误：message 是宿主的原文，`code` 另挂在 Error 上。在应答函数里
 * 抛出它，调用方收到的与真宿主一样。
 */
export function methodNotFound(method: string): Error {
  return Object.assign(new Error(`Method not found: ${method}`), { code: 'METHOD_NOT_FOUND' });
}

/** 普通对象（不含数组与 null）。 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 字符串参数；缺省或类型不对时为空串。 */
export function stringParam(params: HostParams, key: string): string {
  const value = params[key];
  return typeof value === 'string' ? value : '';
}

export function numberParam(params: HostParams, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' ? value : undefined;
}

export function booleanParam(params: HostParams, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** 数组参数；缺省或不是数组时为空数组。 */
export function listParam(params: HostParams, key: string): readonly unknown[] {
  const value = params[key];
  return Array.isArray(value) ? value : [];
}

function isConfigValue(value: unknown): value is ConfigValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isConfigValue);
  return isRecord(value) && Object.values(value).every(isConfigValue);
}

const OK: { readonly success: true } = { success: true };

/** 缺省的两个输出模块：DirectSound 与 WASAPI（共享）。GUID 是替身自造的，好认就行。 */
export const OUTPUT_MODULES = {
  directSound: '{0000000A-0000-0000-0000-000000000001}',
  wasapi: '{0000000A-0000-0000-0000-000000000002}',
} as const;

/** 各模块的缺省设备报全零 GUID，与宿主一致。 */
export const DEFAULT_DEVICE_ID = '{00000000-0000-0000-0000-000000000000}';

/** `output.getEntries` 里的一个输出模块，只有 GUID 与名字要紧，其余几项填缺省。 */
export function outputEntry(
  guid: string,
  name: string,
): OutputGetEntriesSuccess['entries'][number] {
  return {
    guid,
    name,
    needsBitdepthConfig: false,
    needsDitherConfig: false,
    supportsMultipleStreams: false,
    isHighLatency: false,
    isLowLatency: false,
  };
}

/** `config.getOutputDevices` 里的一行；`id` 与宿主一样重复 `deviceId`。 */
export function outputDevice(
  outputId: string,
  deviceId: string,
  name: string,
  isCurrent = false,
): ConfigOutputDevice {
  return { name, id: deviceId, outputId, deviceId, isCurrent };
}

const OUTPUT_DEVICES: ConfigOutputDevice[] = [
  outputDevice(OUTPUT_MODULES.directSound, DEFAULT_DEVICE_ID, 'Primary Sound Driver', true),
  outputDevice(
    OUTPUT_MODULES.directSound,
    '{0000000D-0000-0000-0000-000000000001}',
    'Speakers (Realtek(R) Audio)',
  ),
  outputDevice(
    OUTPUT_MODULES.wasapi,
    '{0000000D-0000-0000-0000-000000000002}',
    'Speakers (Realtek(R) Audio) [exclusive]',
  ),
];

const DEFAULT_PLAYLIST: PlaylistInfo = {
  index: 0,
  guid: '{00000000-0000-0000-0000-000000000000}',
  name: 'Default',
  trackCount: 0,
  isActive: true,
  isPlaying: false,
  isLocked: false,
  isAutoplaylist: false,
};

/**
 * 每个替身实例一份，config 的读写落在传入的 Map 里。
 * `config.set` 与宿主一样把顶层的 null 当作没传，答 INVALID_PARAMS。
 */
export function defaultAnswers(config: Map<string, ConfigValue>): AnswerTable {
  return {
    artwork: {
      getFb2kUrlByPath: (params) => ({
        success: true,
        available: true,
        type: stringParam(params, 'type') || 'front',
        path: stringParam(params, 'path'),
        dataUrl: TINY_PNG,
      }),
    },
    config: {
      getVersionInfo: {
        success: true,
        version: 'foobar2000 v2.25',
        foobar2000: 'foobar2000 v2.25',
        versionFull: 'foobar2000 v2.25 x64',
        is64bit: true,
        isPortable: true,
        profilePath: 'E:/FB2K/foobar2000/profile',
        plugin: { name: 'foo_ui_webview2', version: HOST_VERSION },
      },
      get: (params) => {
        const key = stringParam(params, 'key');
        const value = config.get(key);
        return value === undefined
          ? { success: true, key, value: null, found: false }
          : { success: true, key, value, found: true };
      },
      set: (params) => {
        const key = stringParam(params, 'key');
        const value = params['value'];
        if (value === undefined || value === null) {
          return hostFailure('INVALID_PARAMS', 'value is required');
        }
        if (!isConfigValue(value)) return hostFailure('INVALID_PARAMS', 'value must be JSON');
        config.set(key, value);
        return { success: true, key };
      },
      remove: (params) => {
        const key = stringParam(params, 'key');
        return { success: true, key, existed: config.delete(key) };
      },
      getOutputDevices: {
        success: true,
        devices: OUTPUT_DEVICES,
        count: OUTPUT_DEVICES.length,
      },
      setOutputDevice: OK,
    },
    file: {
      list: hostFailure('NOT_FOUND', 'directory not found'),
      read: hostFailure('NOT_FOUND', 'file not found'),
    },
    library: {
      isEnabled: { success: true, enabled: true },
      getAlbums: (params) => ({
        success: true,
        albums: [],
        total: 0,
        offset: numberParam(params, 'offset') ?? 0,
        limit: numberParam(params, 'limit') ?? 100,
        hasMore: false,
        includeCover: booleanParam(params, 'includeCover') ?? false,
        fromCache: false,
      }),
      getAlbumTracks: (params) => ({
        success: true,
        album: stringParam(params, 'album'),
        albumArtist: stringParam(params, 'albumArtist'),
        tracks: [],
        items: [],
        total: 0,
      }),
      getArtistAlbums: (params) => ({
        success: true,
        artist: stringParam(params, 'artist'),
        albums: [],
        total: 0,
        hasMore: false,
      }),
      getArtists: { success: true, items: [], count: 0 },
      getFieldValues: (params) => ({
        success: true,
        values: [],
        total: 0,
        field: stringParam(params, 'field'),
      }),
      getRoots: {
        success: true,
        enabled: true,
        roots: [],
        total: 0,
        indexedTracks: 0,
        skippedTracks: 0,
        fromCache: false,
      },
      search: (params) => ({
        success: true,
        tracks: [],
        total: 0,
        offset: numberParam(params, 'offset') ?? 0,
        limit: numberParam(params, 'limit') ?? 100,
        hasMore: false,
      }),
      addToPlaylist: (params) => ({ success: true, added: listParam(params, 'paths').length }),
    },
    menu: {
      getMainMenu: (params) => ({
        success: true,
        root: stringParam(params, 'root'),
        requestedRoot: stringParam(params, 'root'),
        rootMatched: true,
        locale: 'zh-CN',
        i18n: true,
        withAvailability: true,
        items: [],
      }),
      runMainMenuCommand: OK,
      getContextMenu: {
        success: true,
        mode: 'selection',
        locale: 'zh-CN',
        i18n: true,
        withAvailability: true,
        items: [],
      },
      runContextCommandById: OK,
    },
    misc: {
      getProfilePath: {
        success: true,
        path: 'E:/FB2K/foobar2000/profile',
        value: 'E:/FB2K/foobar2000/profile',
      },
    },
    playback: {
      getState: { success: true, state: 'stopped', canSeek: false, canPause: false },
      getCurrentTrack: { success: true, found: false },
      getPosition: () => ({
        success: true,
        hostTime: Date.now(),
        position: 0,
        duration: 0,
        subsong: 0,
        path: '',
      }),
      getVolume: { success: true, volume: 100, volumeDb: 0, muted: false, isMuted: false },
      getPlaybackOrder: {
        success: true,
        order: 0,
        orderName: 'default',
        name: 'default',
        orderIndex: 0,
      },
      play: OK,
      pause: OK,
      stop: OK,
      next: OK,
      previous: OK,
      playOrPause: { success: true, isPlaying: true },
      setVolume: OK,
      volumeUp: OK,
      volumeDown: OK,
      toggleMute: { success: true, muted: true },
      setPosition: (params) => {
        const position = numberParam(params, 'position') ?? 0;
        return {
          success: true,
          requestedPosition: position,
          hostTime: Date.now(),
          actualPosition: position,
          oldPosition: 0,
          newPosition: position,
          duration: 0,
          subsong: 0,
        };
      },
      setPlaybackOrder: { success: true, order: 0, orderName: 'default' },
    },
    output: {
      getEntries: {
        success: true,
        entries: [
          outputEntry(OUTPUT_MODULES.directSound, 'DirectSound'),
          outputEntry(OUTPUT_MODULES.wasapi, 'WASAPI (shared)'),
        ],
        count: 2,
      },
    },
    playcount: {
      get: { success: true, count: 0, results: [] },
    },
    playlist: {
      getAll: { success: true, playlists: [DEFAULT_PLAYLIST], count: 1 },
      getActive: {
        success: true,
        found: true,
        index: 0,
        name: 'Default',
        trackCount: 0,
        isActive: true,
        isPlaying: false,
        isLocked: false,
        duration: 0,
      },
      setActive: OK,
      create: { success: true, index: 1, guid: '{00000000-0000-0000-0000-000000000001}' },
      clear: (params) => ({
        success: true,
        playlist: numberParam(params, 'playlist') ?? 0,
        playlistGuid: stringParam(params, 'playlistGuid') || DEFAULT_PLAYLIST.guid,
        clearedCount: 0,
        remainingCount: 0,
      }),
      playTrack: OK,
    },
    queue: {
      get: { success: true, items: [], count: 0 },
      getCount: { success: true, count: 0, hasItems: false },
      add: (params) => {
        const added = listParam(params, 'tracks').length || 1;
        return { success: true, addedCount: added, queueCount: added };
      },
      insertNext: (params) => {
        const inserted = listParam(params, 'paths').length + listParam(params, 'items').length;
        return {
          success: true,
          insertedCount: inserted,
          movedCount: 0,
          queueCount: inserted,
          invalidCount: 0,
        };
      },
    },
    system: {
      getLocale: { success: true, locale: 'zh-CN', language: 'zh', country: 'CN' },
    },
    titleformat: {
      // 没装 foo_playcount 的样子：各首一律答空串。
      evalBatch: (params) => {
        const paths = listParam(params, 'paths').map(String);
        return {
          success: true,
          pattern: stringParam(params, 'pattern'),
          total: paths.length,
          successCount: paths.length,
          errorCount: 0,
          results: paths.map((path) => ({ path, success: true, result: '' })),
        };
      },
      eval: (params) => ({
        success: true,
        path: stringParam(params, 'path'),
        pattern: stringParam(params, 'pattern'),
        result: '',
        infoAvailable: true,
      }),
    },
    discovery: {
      getMainMenuCommands: (params) => ({
        success: true,
        commands: [],
        count: 0,
        expandDynamic: booleanParam(params, 'expandDynamic') ?? true,
        includeHidden: booleanParam(params, 'includeHidden') ?? false,
        dynamicCount: 0,
      }),
    },
    tray: {
      create: OK,
      destroy: OK,
      setTooltip: OK,
      setContextMenu: OK,
      appendMenuItems: OK,
      clearMenuItems: OK,
      setMenuZones: OK,
      setMinimizeToTray: OK,
      setCloseToTray: OK,
    },
    window: {
      getMode: { success: true, mode: 'standalone', panelMode: false, windowId: 'main' },
      getCurrentWindowId: { success: true, windowId: 'main' },
      getState: {
        success: true,
        maximized: false,
        minimized: false,
        fullscreen: false,
        alwaysOnTop: false,
        focused: true,
        isMaximized: false,
        isMinimized: false,
        isFullscreen: false,
        isAlwaysOnTop: false,
        isFocused: true,
        width: 1280,
        height: 800,
        x: 0,
        y: 0,
      },
      minimize: OK,
      maximize: OK,
      restore: OK,
      close: OK,
      focus: OK,
      startDrag: OK,
      setTitle: OK,
      toggleMaximize: { success: true, maximized: true },
      setTitlebarHeight: (params) => ({
        success: true,
        height: numberParam(params, 'height') ?? 0,
      }),
      // Windows 10 的样子：矩形收下了，但系统不给贴靠布局，最大化键照常挂悬停提示。
      setMaximizeButtonRegion: { success: true, hasRegion: true, snapLayouts: false, scale: 1 },
    },
  };
}
