import {Link} from '@tanstack/react-router';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

const ROUTE_LABELS = {
  '/account': 'Account',
  '/theme': 'Theme',
  '/security': 'Security',
} as const;

type SettingsBreadcrumbProps = {
  route: keyof typeof ROUTE_LABELS;
};

export function SettingsBreadcrumb({route}: SettingsBreadcrumbProps) {
  const pageTitle = ROUTE_LABELS[route];

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to='/home'>Home</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbLink asChild>
          <Link to='/settings/account'>Settings</Link>
        </BreadcrumbLink>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
