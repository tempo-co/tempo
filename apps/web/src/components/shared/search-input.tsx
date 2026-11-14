import {Search, X} from 'lucide-react';
import {type ComponentProps, useEffect, useEffectEvent, useRef} from 'react';

import {Input} from '@/components/ui/input';
import {cn} from '@/utils/cn';

type SearchInputProps = Omit<ComponentProps<'input'>, 'ref' | 'type' | 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Runs after the clear button or Escape empties the field, so a caller can drop its debounce. */
  onClear?: () => void;
  /** Classes for the wrapper, which sizes the field. */
  wrapperClassName?: string;
};

/**
 * A search field with a leading icon and a clear button that shows once there is text. Escape clears a filled field;
 * on an empty one it reaches whatever else handles it, such as a dialog closing.
 */
export function SearchInput({
  value,
  onValueChange,
  onClear,
  wrapperClassName,
  className,
  ...props
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clear = () => {
    onValueChange('');
    onClear?.();
    inputRef.current?.focus();
  };
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    // Escape during IME composition cancels the composition, not the search.
    if (event.key !== 'Escape' || event.isComposing || event.target !== inputRef.current || !value)
      return;
    event.preventDefault();
    event.stopPropagation();
    clear();
  });

  // Dialogs listen for Escape on the document in the capture phase and close before the field sees the key, so the
  // field listens on the window, which the capture phase reaches first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onEscape(event);
    window.addEventListener('keydown', onKeyDown, {capture: true});
    return () => window.removeEventListener('keydown', onKeyDown, {capture: true});
  }, []);

  return (
    <div className={cn('relative min-w-0', wrapperClassName)}>
      <Search className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
      <Input
        ref={inputRef}
        type='search'
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          'pl-9 [&::-webkit-search-cancel-button]:appearance-none',
          value && 'pr-12 sm:pr-9 pointer-coarse:pr-12',
          className,
        )}
        {...props}
      />
      {value && (
        <button
          type='button'
          onClick={clear}
          aria-label='Clear search'
          className='absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:w-9 pointer-coarse:w-12'
        >
          <X className='h-4 w-4' />
        </button>
      )}
    </div>
  );
}
