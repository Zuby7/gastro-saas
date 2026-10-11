"use client";

import type { PointerEvent, ReactNode } from "react";

/**
 * Tiny client wrapper that feeds the pointer position into the `--lp-mx` /
 * `--lp-my` CSS variables used by the `.lp-holo` glare layer (landing.css).
 * Purely presentational: no state, no re-render on move (writes CSS variables
 * directly), and without JS or with reduced motion the card still renders its
 * static holographic border. The glare itself is a hover-only paint effect.
 */
export function HoloCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--lp-mx", `${event.clientX - rect.left}px`);
    el.style.setProperty("--lp-my", `${event.clientY - rect.top}px`);
  }

  return (
    <div className={`lp-holo ${className}`} onPointerMove={handlePointerMove}>
      {children}
    </div>
  );
}
