import {SideBar} from '@/components/sidebar/sidebar';
import {createLazyFileRoute} from '@tanstack/react-router';

export const Route = createLazyFileRoute('/')({
  component: Index,
});

function Index() {
  return (
    <>
      <SideBar />
    </>
  );
}
