import {SideBar} from '@/components/shared/sidebar';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/transactions')({
  component: Transactions,
});

function Transactions() {
  return (
    <div className='flex'>
      <SideBar />
      <p>Transactions</p>
    </div>
  );
}
