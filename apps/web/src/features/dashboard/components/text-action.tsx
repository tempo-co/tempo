import {Button, type ButtonProps} from '@/components/ui/button';
import {cn} from '@/utils/cn';

/**
 * Home's text actions, such as "All", "Show fewer" and "Transactions in this span": one ghost button style
 * in the link colour, 44px tall on touch. `asChild` renders a link in the same style.
 */
export function TextAction({className, ...props}: ButtonProps) {
  return (
    <Button
      variant='ghost'
      size='sm'
      className={cn('w-fit px-2 font-normal text-primary hover:text-primary', className)}
      {...props}
    />
  );
}
