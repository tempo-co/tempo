import {useEffect, useRef, useState} from 'react';

type LoadingBarProps = {
  isPending: boolean;
};

export function LoadingBar({isPending}: LoadingBarProps) {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const animationFrameRef = useRef<number | null>(null);

  // A new load restarts the bar from empty; the end of one fills it before it fades out.
  const [wasPending, setWasPending] = useState(false);
  if (isPending !== wasPending) {
    setWasPending(isPending);
    if (isPending) {
      setVisible(true);
      setWidth(0);
    } else if (visible) {
      setWidth(100);
    }
  }

  useEffect(() => {
    if (!isPending) return;
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
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPending]);

  useEffect(() => {
    if (isPending || !visible) return;
    const fadeOutTimeout = setTimeout(() => setVisible(false), 300);
    return () => clearTimeout(fadeOutTimeout);
  }, [isPending, visible]);

  if (!visible) return null;

  return (
    <div className='absolute top-0 right-0 left-0 z-10 h-[2px] rounded-t-md rounded-b-none bg-transparent'>
      <div
        className='h-full bg-primary transition-all duration-300 ease-out'
        style={{width: `${width}%`, opacity: !isPending && width >= 100 ? 0 : 1}}
      />
    </div>
  );
}
