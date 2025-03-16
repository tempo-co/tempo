import {MonitorSmartphone, Moon, Sun} from 'lucide-react';

import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {useMediaQuery} from '@/hooks/use-media-query';
import {useTheme} from '@/hooks/use-theme';
import {Theme, themes} from '@/providers/theme.provider';
import {cn} from '@/utils/cn';

export function ThemeSwitcher() {
  const {theme, setTheme} = useTheme();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <RadioGroup
        defaultValue='light'
        className='flex gap-5'
        value={theme}
        onValueChange={(value: Theme) => setTheme(value)}
      >
        {themes.map((themeValue) => (
          <div className='relative' key={themeValue}>
            <label htmlFor={themeValue} className='cursor-pointer'>
              <div
                className={cn(
                  'flex w-fit rounded-b-lg rounded-t-lg border hover:border-primary',
                  theme === themeValue && 'border-primary',
                )}
              >
                <div className='relative'>
                  <div
                    className='relative overflow-hidden rounded-t-lg bg-background p-2 xl:p-3'
                    data-theme-preview={themeValue === 'system' ? 'light' : themeValue}
                  >
                    <div>
                      <div className='flex gap-3'>
                        <div className='h-2 w-10 rounded-md bg-muted lg:h-3'></div>
                        <div className='h-2 w-10 rounded-md bg-muted lg:h-3'></div>
                      </div>
                      <div className='mt-2 h-14 w-28 rounded-md bg-muted pt-2 lg:mt-3 lg:w-40'>
                        <div className='flex h-4 min-w-6 items-center bg-secondary'>
                          <div className='ml-1 h-2 w-fit min-w-7 rounded-md bg-primary lg:min-w-10'></div>
                        </div>
                      </div>
                    </div>
                    {themeValue === 'system' && (
                      <div
                        data-theme-preview='dark'
                        className='absolute inset-0 z-10 flex flex-col bg-background p-2 lg:p-3'
                        style={{
                          clipPath: 'polygon(100% 0, 100% 100%, 0 100%, 100% 0)',
                        }}
                      >
                        <div className='flex gap-3'>
                          <div className='h-2 w-10 rounded-md bg-muted lg:h-3'></div>
                          <div className='h-2 w-10 rounded-md bg-muted lg:h-3'></div>
                        </div>
                        <div className='mt-2 h-14 w-28 rounded-md bg-muted pt-2 lg:mt-3 lg:w-40'>
                          <div className='flex h-4 min-w-6 items-center bg-secondary'>
                            <div className='ml-1 h-2 w-fit min-w-7 rounded-md bg-primary lg:min-w-10'></div>
                          </div>
                        </div>
                      </div>
                    )}
                    {themeValue === 'system' && (
                      <div
                        className='pointer-events-none absolute inset-0 z-20'
                        style={{
                          background:
                            'linear-gradient(to bottom right, transparent calc(100% - 1px), var(--border) calc(100%), transparent calc(100% + 1px))',
                        }}
                      ></div>
                    )}
                  </div>
                  <div
                    className='relative flex items-center space-x-2 px-3 py-2'
                    style={{zIndex: 30}}
                  >
                    <RadioGroupItem value={themeValue} id={themeValue} className='peer' />
                    <p className='capitalize'>{themeValue}</p>
                  </div>
                </div>
              </div>
            </label>
          </div>
        ))}
      </RadioGroup>
    );
  }

  const themeIcons = {
    light: <Sun className='mr-2 h-4 w-4 text-muted-foreground' />,
    dark: <Moon className='mr-2 h-4 w-4 text-muted-foreground' />,
    system: <MonitorSmartphone className='mr-2 h-4 w-4 text-muted-foreground' />,
  };

  return (
    <RadioGroup
      defaultValue='light'
      className='flex flex-col gap-5'
      value={theme}
      onValueChange={(value: Theme) => setTheme(value)}
    >
      {themes.map((themeValue) => (
        <div className='relative' key={themeValue}>
          <div className='relative w-full'>
            <RadioGroupItem
              value={themeValue}
              id={`mobile-${themeValue}`}
              className='absolute left-4 top-1/2 z-10 -translate-y-1/2'
            />
            <label
              htmlFor={`mobile-${themeValue}`}
              className='flex w-full cursor-pointer items-center rounded-md px-12 py-4 hover:bg-muted'
            >
              {themeIcons[themeValue]}
              <span className='capitalize'>{themeValue}</span>
            </label>
          </div>
        </div>
      ))}
    </RadioGroup>
  );
}
