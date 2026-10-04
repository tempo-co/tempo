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
      variant='outline'
      aria-labelledby='theme-heading'
      value={theme}
      // Radix clears the value when the active item is clicked again; keep a theme selected.
      onValueChange={(value) => value && setTheme(value as Theme)}
      className='w-full sm:w-fit'
    >
      {themes.map((value) => {
        const Icon = icons[value];
        return (
          <ToggleGroupItem
            key={value}
            value={value}
            className='min-h-11 flex-1 data-[state=on]:border-primary data-[state=on]:font-semibold data-[state=on]:text-foreground sm:min-w-28 sm:flex-none'
          >
            <Icon />
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
