import {useCallback, useEffect, useRef, useState} from 'react';
import type {MouseEvent, PointerEvent, TouchEvent} from 'react';

const HOLD_MS = 250;
const MOVE_PX = 8;

type Gesture = {
  id: number;
  x: number;
  y: number;
  inspecting: boolean;
  timer: ReturnType<typeof setTimeout>;
};

/** Touch inspects only while held; a tap remains the chart's normal click action. */
export function useChartTouch() {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const tapped = useRef(false);
  const [touch, setTouch] = useState(false);
  const [inspecting, setInspecting] = useState(false);

  // Recharts handles mouse/touch-move, but not pointer events or stationary touch-down.
  // Bridge inspection coordinates through its normal mouse event path, including a hold.
  const point = (x: number, y: number) => {
    ref.current
      ?.querySelector('.recharts-wrapper')
      ?.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: x, clientY: y}));
  };

  const leave = () => {
    ref.current
      ?.querySelector('.recharts-wrapper')
      ?.dispatchEvent(new window.MouseEvent('mouseout', {bubbles: true}));
  };

  const finish = useCallback(() => {
    if (gesture.current) clearTimeout(gesture.current.timer);
    gesture.current = null;
    setInspecting(false);
    leave();
  }, []);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) finish();
    };
    window.addEventListener('blur', finish);
    document.addEventListener('visibilitychange', hide);
    return () => {
      if (gesture.current) clearTimeout(gesture.current.timer);
      window.removeEventListener('blur', finish);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [finish]);

  const activate = (current: Gesture) => {
    clearTimeout(current.timer);
    current.inspecting = true;
    suppressClick.current = true;
    ref.current?.setPointerCapture(current.id);
    setInspecting(true);
  };

  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    tapped.current = false;
    if (event.pointerType === 'mouse') {
      setTouch(false);
      return;
    }
    setTouch(true);
    if (!event.isPrimary) {
      suppressClick.current = true;
      finish();
      return;
    }
    point(event.clientX, event.clientY);
    const current: Gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      inspecting: false,
      timer: setTimeout(() => activate(current), HOLD_MS),
    };
    gesture.current = current;
  };

  const onPointerMoveCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') {
      setTouch(false);
      return;
    }
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.inspecting) {
      const dx = Math.abs(event.clientX - current.x);
      const dy = Math.abs(event.clientY - current.y);
      if (Math.max(dx, dy) < MOVE_PX) return;
      if (dy >= dx) {
        suppressClick.current = true;
        finish();
        return;
      }
      activate(current);
    }
    point(event.clientX, event.clientY);
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    if (current.inspecting || event.type !== 'pointerup') return finish();
    // A tap's click follows and reads the bar under the finger; the pointer leaves after it.
    clearTimeout(current.timer);
    gesture.current = null;
    tapped.current = true;
  };

  return {
    ref,
    touch,
    inspecting,
    handlers: {
      onPointerDownCapture,
      onPointerMoveCapture,
      onPointerUpCapture: end,
      onPointerCancelCapture: end,
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) end(event);
      },
      // The pointer bridge owns inspection, not Recharts' native touch-move path.
      onTouchMoveCapture: (event: TouchEvent<HTMLDivElement>) => event.stopPropagation(),
      onKeyDownCapture: () => setTouch(false),
      onContextMenu: (event: MouseEvent<HTMLDivElement>) => {
        if (gesture.current) event.preventDefault();
      },
      onClick: () => {
        if (!tapped.current) return;
        tapped.current = false;
        leave();
      },
      onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
        if (suppressClick.current && event.detail > 0) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}
