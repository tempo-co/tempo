import {Link} from '@tanstack/react-router';
import {ChevronRight} from 'lucide-react';

import {cn} from '@/utils/cn';

import {LATER_SETTINGS_SECTIONS, SETTINGS_SECTIONS, type SettingsSection} from '../sections';

const LATER = <span className='ml-auto text-label text-faint'>later</span>;

/** Desktop: the sections down the left of the content, the open one on a card with a hairline. */
export function SettingsSectionNav({current}: {current: SettingsSection | undefined}) {
  return (
    <nav aria-label='Settings sections' className='sticky top-8'>
      <ul className='flex flex-col gap-0.5'>
        {SETTINGS_SECTIONS.map((section) => {
          const active = section === current;
          return (
            <li key={section.to}>
              <Link
                to={section.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-3 rounded-md border border-transparent px-2.5 text-body text-muted-foreground transition-colors hover:bg-sunk hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11 [&>svg]:size-4 [&>svg]:shrink-0',
                  active && 'border-border bg-card font-medium text-foreground',
                )}
              >
                <section.icon aria-hidden='true' />
                <span className='min-w-0 truncate'>{section.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <ul className='mt-2 flex flex-col gap-0.5 border-t pt-2'>
        {LATER_SETTINGS_SECTIONS.map((section) => (
          <li
            key={section.label}
            aria-disabled='true'
            className='flex h-8 items-center gap-3 px-2.5 text-body text-muted-foreground opacity-60 [&>svg]:size-4 [&>svg]:shrink-0'
          >
            <section.icon aria-hidden='true' />
            <span className='min-w-0 truncate'>{section.label}</span>
            {LATER}
          </li>
        ))}
      </ul>
    </nav>
  );
}

const ROW = 'flex min-h-16 items-center gap-3 px-4 py-3';
const TILE =
  'grid size-9 shrink-0 place-items-center rounded-full bg-sunk text-muted-foreground [&>svg]:size-4';

/** Phones: the sections as one grouped list to tap into, then the announced ones. */
export function SettingsSectionList() {
  return (
    <nav aria-label='Settings sections' className='space-y-3'>
      <ul className='divide-y overflow-hidden rounded-lg border bg-card'>
        {SETTINGS_SECTIONS.map((section) => (
          <li key={section.to}>
            <Link
              to={section.to}
              className={cn(
                ROW,
                'press-feedback hover:bg-sunk focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              )}
            >
              <span className={TILE}>
                <section.icon aria-hidden='true' />
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block text-body font-medium'>{section.label}</span>
                <span className='mt-0.5 block text-body-small wrap-break-word text-muted-foreground'>
                  {section.description}
                </span>
              </span>
              <ChevronRight className='size-4 shrink-0 text-faint' aria-hidden='true' />
            </Link>
          </li>
        ))}
      </ul>
      <ul className='divide-y overflow-hidden rounded-lg border bg-card'>
        {LATER_SETTINGS_SECTIONS.map((section) => (
          <li key={section.label} aria-disabled='true' className={cn(ROW, 'opacity-60')}>
            <span className={TILE}>
              <section.icon aria-hidden='true' />
            </span>
            <span className='min-w-0 flex-1 text-body font-medium'>{section.label}</span>
            {LATER}
          </li>
        ))}
      </ul>
    </nav>
  );
}
