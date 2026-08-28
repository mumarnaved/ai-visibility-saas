"use client";

import { useEffect, useRef, useState } from "react";

/* ========================================
   USE COUNT UP

   Animates a displayed number from its
   previous value up (or down) to a new
   target whenever that target changes -
   used for scores/stats so they visibly
   settle into place instead of popping in.
   Respects prefers-reduced-motion by
   jumping straight to the target.
======================================== */

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function useCountUp(
  target: number,
  durationMs = 900
): number {
  const [value, setValue] =
    useState(target);

  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(
    null
  );

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

    if (
      prefersReducedMotion ||
      !Number.isFinite(target)
    ) {
      setValue(target);
      fromRef.current = target;
      return;
    }

    const from = fromRef.current;
    const delta = target - from;

    if (delta === 0) {
      return;
    }

    const start =
      typeof performance !== "undefined"
        ? performance.now()
        : Date.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(
        1,
        elapsed / durationMs
      );

      const eased =
        easeOutExpo(progress);

      setValue(
        from + delta * eased
      );

      if (progress < 1) {
        frameRef.current =
          requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    }

    frameRef.current =
      requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(
          frameRef.current
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
