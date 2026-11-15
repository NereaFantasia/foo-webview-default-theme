import { useEffect, useReducer, useState } from 'react';

/**
 * 根据照片宽高比划分布局形态，决定艺人页头部呈现方式：
 * 近似方形显示为圆形头像，其余横竖比例均采用扩展横幅展示且保持图像不被裁切；
 * 铺满头部的背景图层仅用于数据源专门提供的宽幅艺术照与动态视频，不依据普通照片比例自动铺满
 */
export type PhotoShape = 'round' | 'rect';

/** 判定为近似方形的宽高比区间，裁切为圆形时仅截取四个角落 */
const ROUND_MIN = 0.8;
const ROUND_MAX = 1.25;

export function photoShape(width: number, height: number): PhotoShape {
  const ratio = width / height;
  return ratio >= ROUND_MIN && ratio <= ROUND_MAX ? 'round' : 'rect';
}

// 已测量 URL 的比例缓存；运行时记录规模较小，直接保留在 Map 中
const measured = new Map<string, PhotoShape>();

/**
 * 测量指定图像的宽高比：
 * 元数据不包含尺寸信息，需等待图像实际加载完成；
 * 未提供地址或尚未完成测量时返回 null，调用方应暂缓渲染以避免头像形状跳变；
 * 加载失败返回 'failed'，仅在当前挂载生命周期内保留状态；相同地址全局仅测量一次
 */
export function usePhotoShape(url: string | undefined): PhotoShape | 'failed' | null {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!url || measured.has(url)) return;
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        if (alive) setFailed(url);
        return;
      }
      measured.set(url, photoShape(image.naturalWidth, image.naturalHeight));
      if (alive) redraw();
    };
    image.onerror = () => {
      if (alive) setFailed(url);
    };
    image.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  if (!url) return null;
  return measured.get(url) ?? (failed === url ? 'failed' : null);
}
