import {MonitorSmartphone, Moon, Sun} from 'lucide-react';

import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {useMediaQuery} from '@/hooks/use-media-query';
import {useTheme} from '@/hooks/use-theme';
import {Theme, themes} from '@/providers/theme.provider';
import {cn} from '@/utils/cn';

export function ThemeSwitcher() {
  const {theme, setTheme} = useTheme();
  const isDesktop = useMediaQuery('(min-width: 768px)');

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
    <Tabs value={theme} onValueChange={(value) => setTheme(value as Theme)} className='w-full'>
      <TabsList className={cn(!isDesktop && 'w-full')}>
        {themeOptions.map((option) => {
          const Icon = option.icon;
          return (
            <TabsTrigger
              key={option.value}
              value={option.value}
              className={cn('flex items-center gap-2 rounded-md', !isDesktop && 'w-full')}
            >
              <Icon className='h-4 w-4' />
              <span>{option.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
