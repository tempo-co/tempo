import {MonitorSmartphone, Moon, Sun} from 'lucide-react';

import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {useTheme} from '@/hooks/use-theme';
import {Theme, themes} from '@/providers/theme.provider';

export function ThemeSwitcher() {
  const {theme, setTheme} = useTheme();

  const themeOptions = themes.map((value) => {
    const icons = {
      light: Sun,
      dark: Moon,
      system: MonitorSmartphone,
    };
    return {
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
      icon: icons[value],
    };
  });

  return (
    <Tabs
      value={theme}
      onValueChange={(v) => setTheme(v as Theme)}
      className='w-full rounded-card border bg-card p-2 shadow-sm sm:p-3'
    >
      <TabsList
        aria-label='Theme'
        className='flex h-auto w-full gap-1 rounded-lg border bg-muted/60 p-1 md:w-auto'
      >
        {themeOptions.map((opt) => (
          <TabsTrigger
            key={opt.value}
            value={opt.value}
            className='min-h-11 flex-1 gap-2 px-3 py-2 text-xs sm:text-sm md:min-w-[7rem] md:flex-none'
          >
            <opt.icon className='h-4 w-4' />
            <span>{opt.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
