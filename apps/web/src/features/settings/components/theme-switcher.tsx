import {MonitorSmartphone, Moon, Sun} from 'lucide-react';

import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {useTheme} from '@/hooks/use-theme';
import {Theme, themes} from '@/providers/theme.provider';

const icons = {
  light: Sun,
  dark: Moon,
  system: MonitorSmartphone,
};

export function ThemeSwitcher() {
  const {theme, setTheme} = useTheme();

  return (
    <ToggleGroup
      type='single'
      aria-labelledby='theme-heading'
      value={theme}
      // Radix clears the value when the active item is clicked again; keep a theme selected.
      onValueChange={(value) => value && setTheme(value as Theme)}
      className='grid grid-cols-3 gap-0 divide-x rounded-card border bg-card'
    >
      {themes.map((value) => {
        const Icon = icons[value];
        return (
          <ToggleGroupItem
            key={value}
            value={value}
            // A chosen value, not navigation: clay ring and icon instead of an underline.
            className='h-auto min-h-16 flex-col gap-1.5 rounded-none py-3 text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:-outline-offset-2 data-[state=on]:bg-accent data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:ring-2 data-[state=on]:ring-primary data-[state=on]:ring-inset [&_svg]:size-5 data-[state=on]:[&_svg]:text-primary'
          >
            <Icon aria-hidden />
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
