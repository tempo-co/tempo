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
    <Tabs value={theme} onValueChange={(v) => setTheme(v as Theme)} className='w-full'>
      <TabsList className='w-full md:w-auto'>
        {themeOptions.map((opt) => (
          <TabsTrigger
            key={opt.value}
            value={opt.value}
            className='flex w-full items-center gap-2 rounded-md md:w-auto'
          >
            <opt.icon className='h-4 w-4' />
            <span>{opt.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
