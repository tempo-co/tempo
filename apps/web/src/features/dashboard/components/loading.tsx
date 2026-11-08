import {cn} from '@/utils/cn';

/**
 * A placeholder for text still loading, inside the element the text will fill. That element keeps its own font
 * size and line height, so the line is as tall as it will be with the text in it.
 */
export function TextBone({className}: {className?: string}) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'inline-block h-[0.75em] animate-pulse bg-muted align-middle motion-reduce:animate-none',
        className,
      )}
    />
  );
}

/** A placeholder block for a mark (a chart, a tile, a bar) still loading. */
export function Bone({className}: {className?: string}) {
  return (
    <span
      aria-hidden='true'
      className={cn('block animate-pulse bg-muted motion-reduce:animate-none', className)}
    />
  );
}

/** Placeholder rows as tall as a transaction's or merchant's row: a round tile, two lines and an amount. */
export function TileRowsSkeleton({count}: {count: number}) {
  return Array.from({length: count}, (_, index) => (
    <li
      key={index}
      aria-hidden='true'
      className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3'
    >
      <Bone className='size-9 rounded-full' />
      <span className='min-w-0'>
        <span className='block text-sm'>
          <TextBone className='w-[9em]' />
        </span>
        <span className='block text-xs'>
          <TextBone className='w-[6em]' />
        </span>
      </span>
      <span className='text-sm'>
        <TextBone className='w-[4em]' />
      </span>
    </li>
  ));
}

/** A loading section's one accessible label; its placeholders are hidden from screen readers. */
export function LoadingLabel({children = 'Loading'}: {children?: string}) {
  return <span className='sr-only'>{children}</span>;
}
