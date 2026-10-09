import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { baseAccentToneAtom } from '../baseAccent.ts';
import { colorSchemeAtom } from '../colorScheme.ts';
import {
  backgroundCoverAtom,
  backgroundSourceAtom,
  backgroundTransportAtom,
} from './windowBackground.ts';
import { createFlowMotion } from './flowMotion.ts';
import type { FlowInput, FlowMemory, FlowSurface } from './flowingSurface.ts';

export interface FlowActivity {
  readonly visible: boolean;
  readonly focused: boolean;
}
export interface FlowingFieldOptions {
  readonly store: Store;
  readonly activity: Atom<FlowActivity>;
  readonly create?: (
    element: Pick<HTMLElement, 'append'>,
    memory: FlowMemory,
    signal: AbortSignal,
    ready: () => void,
  ) => Promise<FlowSurface>;
}

export function startFlowingField({
  store,
  activity,
  create = async (element, memory, signal, ready) => {
    const module = await import('./flowingSurface.ts');
    signal.throwIfAborted();
    return module.createFlowingSurface(element, memory, ready);
  },
}: FlowingFieldOptions) {
  const state = atom((get) => {
    const window = get(activity),
      source = get(backgroundSourceAtom),
      transport = get(backgroundTransportAtom);
    const cover = get(backgroundCoverAtom);
    return {
      enabled: source === 'palette',
      visible: window.visible && source === 'palette',
      input: {
        url: transport === 'stopped' ? '' : cover.url,
        profile: transport === 'stopped' ? null : cover.profile,
        base: get(baseAccentToneAtom),
        running: transport === 'playing' || transport === 'paused',
        paused: transport === 'paused',
        reduced: get(reducedMotionAtom),
        focused: window.focused,
        scheme: get(colorSchemeAtom),
      } satisfies FlowInput,
    };
  });
  const memory: FlowMemory = {
    motion: createFlowMotion(),
    gpuFailed: false,
    cover: null,
    preview: null,
  };
  let target: Pick<HTMLElement, 'append'> | null = null;
  let onReady: () => void = () => {};
  let notified = false;
  let surface: FlowSurface | null = null;
  let generation = 0;
  let starting = false;
  let failed = false;
  let disposed = false;
  let request: AbortController | null = null;
  function presented() {
    if (notified) return;
    notified = true;
    onReady();
  }
  function release(retain = false) {
    generation++;
    request?.abort();
    request = null;
    starting = false;
    const old = surface;
    surface = null;
    if (retain) old?.suspend();
    old?.dispose();
  }
  function clearCache() {
    memory.cover = null;
    memory.preview = null;
  }
  function sync() {
    if (disposed) return;
    const current = store.get(state);
    if (!target) {
      release();
      if (!current.enabled) clearCache();
      return;
    }
    if (!current.enabled || !current.visible) {
      if (surface) surface.suspend(current.input.scheme, !current.input.url);
      else if (starting) release();
      return;
    }
    if (surface) {
      try {
        surface.update(current.input);
      } catch {
        failed = true;
        release();
        presented();
      }
      return;
    }
    if (failed) {
      presented();
      return;
    }
    if (starting) return;
    starting = true;
    const mine = ++generation;
    const element = target;
    const controller = new AbortController();
    request = controller;
    void Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return create(element, memory, controller.signal, () => {
          if (!disposed && mine === generation && target === element) presented();
        });
      })
      .then((next) => {
        if (disposed || mine !== generation) {
          next.dispose();
          return;
        }
        starting = false;
        surface = next;
        sync();
      })
      .catch(() => {
        if (!disposed && mine === generation) {
          starting = false;
          failed = true;
          presented();
        }
      });
  }
  const off = store.sub(state, sync);
  return {
    attach(element: Pick<HTMLElement, 'append'>, ready: () => void = () => {}): () => void {
      if (disposed) return () => {};
      if (target !== element) release(true);
      target = element;
      onReady = ready;
      notified = false;
      sync();
      return () => {
        if (target === element) {
          target = null;
          release(true);
          if (!store.get(state).enabled) clearCache();
        }
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      off();
      target = null;
      release();
      clearCache();
    },
  };
}

export type FlowingField = ReturnType<typeof startFlowingField>;
export const flowingFieldKey = serviceKey<FlowingField>('flowingField');
