import {Link, useLocation} from '@tanstack/react-router';
import {Compass} from 'lucide-react';

import {StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';

export function NotFound() {
  const {pathname} = useLocation();
  return (
    <div className='flex justify-center px-4 py-16 sm:px-6 sm:py-24'>
      <StateMessage
        className='w-full max-w-md'
        titleAs='h1'
        icon={Compass}
        title="This page doesn't exist"
        description='The link may be old or mistyped.'
        detail={`404 · ${pathname}`}
      >
        <Button asChild>
          <Link to='/'>Back to Home</Link>
        </Button>
      </StateMessage>
    </div>
  );
}
