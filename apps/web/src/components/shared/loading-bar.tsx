import {useEffect, useRef, useState} from 'react';

import {cn} from '@/utils/cn';

type LoadingBarProps = {
  isPending: boolean;
};

export function LoadingBar({isPending}: LoadingBarProps) {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const fadeOutTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isPending) {
      setVisible(true);
      setWidth(0);

      const animate = () => {
        setWidth((prev) => {
          const nextWidth = prev + (100 - prev) * 0.3;
          if (nextWidth < 100) {
            animationFrameRef.current = requestAnimationFrame(animate);
          }
          return nextWidth;
        });
      };

      animationFrameRef.current = requestAnimationFrame(animate);
    } else if (visible) {
      setWidth(100);
      fadeOutTimeoutRef.current = setTimeout(() => {
        setVisible(false);
      }, 300);
    }

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (fadeOutTimeoutRef.current !== null) {
        clearTimeout(fadeOutTimeoutRef.current);
      }
    };
  }, [isPending, visible]);

  if (!visible) return null;

  return (
    <div className='absolute left-0 right-0 top-0 z-10 h-[2px] rounded-b-none rounded-t-md bg-transparent'>
      <div
        className={cn('h-full bg-primary transition-all duration-300 ease-out')}
        style={{width: `${width}%`, opacity: !isPending && width >= 100 ? 0 : 1}}
      />
    </div>
  );
}
