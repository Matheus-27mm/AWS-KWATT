'use client';

// Anima um número do valor anterior ao novo. Respeita a preferência de movimento reduzido.

import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from '@/lib/prefs';

export function useCountUp(
  target: number | null,
  duration = 700,
): number | null {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number | null>(target);

  useEffect(() => {
    if (target == null || reduced) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = from.current ?? target;
    if (start === target) {
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = start + (target - start) * eased;
      setShown(value);
      if (p < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        from.current = target;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduced]);

  return shown;
}
