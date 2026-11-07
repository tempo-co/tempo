import * as React from 'react';
import * as RechartsPrimitive from 'recharts';

import {useChartTouch} from '@/hooks/use-chart-touch';
import {cn} from '@/utils/cn';

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = {light: '', dark: '.dark'} as const;

const INITIAL_DIMENSION = {width: 320, height: 200} as const;

const ChartTouchContext = React.createContext({touch: false, inspecting: false});

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
  } & (
    {color?: string; theme?: never} | {color?: never; theme: Record<keyof typeof THEMES, string>}
  )
>;

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
  initialDimension?: {
    width: number;
    height: number;
  };
}) {
  const {ref, touch, inspecting, handlers} = useChartTouch();
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartTouchContext value={{touch, inspecting}}>
      <div
        ref={ref}
        data-slot='chart'
        data-chart={chartId}
        className={cn(
          "flex aspect-video touch-pan-y touch-pinch-zoom justify-center text-xs select-none [-webkit-touch-callout:none] [&_.recharts-cartesian-axis-tick-value]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-surface]:outline-hidden [&_svg_*]:outline-none",
          className,
        )}
        {...props}
        {...handlers}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartTouchContext>
  );
}

const ChartStyle = ({id, config}: {id: string; config: ChartConfig}) => {
  const colorConfig = Object.entries(config).filter(
    ([, itemConfig]) => itemConfig.theme ?? itemConfig.color,
  );

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ?? itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .join('\n')}
}
`,
          )
          .join('\n'),
      }}
    />
  );
};

function ChartTooltip(props: React.ComponentProps<typeof RechartsPrimitive.Tooltip>) {
  const {touch, inspecting} = React.useContext(ChartTouchContext);
  const label = RechartsPrimitive.useActiveTooltipLabel();
  const lastLabel = React.useRef<string | number | undefined>(undefined);
  React.useEffect(() => {
    if (!inspecting) {
      lastLabel.current = undefined;
      return;
    }
    if (label !== undefined && label !== lastLabel.current) {
      lastLabel.current = label;
      navigator.vibrate?.(8);
    }
  }, [inspecting, label]);

  return (
    <RechartsPrimitive.Tooltip
      {...props}
      active={touch ? inspecting : props.active}
      position={touch ? {y: 0} : props.position}
      isAnimationActive={touch ? false : props.isAnimationActive}
    />
  );
}

export {ChartContainer, ChartStyle, ChartTooltip};
