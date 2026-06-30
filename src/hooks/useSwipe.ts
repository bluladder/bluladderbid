import { useRef } from 'react';

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

interface SwipeOptions {
  /** Minimum horizontal distance (px) to count as a swipe. */
  threshold?: number;
  /** Max vertical drift (px) allowed before it's treated as a scroll, not a swipe. */
  maxVertical?: number;
}

/**
 * Lightweight touch-swipe detector for left/right gestures.
 * Spread the returned handlers onto any element:
 *   <div {...useSwipe({ onSwipeLeft, onSwipeRight })} />
 * Ignores mostly-vertical movement so page scrolling still works.
 */
export function useSwipe(
  { onSwipeLeft, onSwipeRight }: SwipeHandlers,
  { threshold = 45, maxVertical = 60 }: SwipeOptions = {}
) {
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      startX.current = t.clientX;
      startY.current = t.clientY;
      tracking.current = true;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!tracking.current) return;
      tracking.current = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;
      if (Math.abs(dy) > maxVertical) return; // vertical scroll, ignore
      if (Math.abs(dx) < threshold) return; // too small
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    },
  };
}
