"use client";

import { useCountUp } from "../hooks/useCountUp";

/* ========================================
   COUNT UP NUMBER

   Drop-in replacement for rendering a raw
   score/stat value - animates from the
   previous render's value to the new one.
   `decimals` controls rounding (0 for
   scores, 1-2 for rates/averages).
======================================== */

export default function CountUpNumber({
  value,
  decimals = 0,
  durationMs = 900,
  className,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
  className?: string;
}) {
  const animated = useCountUp(
    value,
    durationMs
  );

  return (
    <span
      className={
        className
          ? `count-up-value ${className}`
          : "count-up-value"
      }
    >
      {animated.toFixed(decimals)}
    </span>
  );
}
