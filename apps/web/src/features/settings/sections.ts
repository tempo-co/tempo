import {
  Bell,
  CreditCard,
  Database,
  type LucideIcon,
  Plug,
  Shapes,
  ShieldCheck,
  SunMoon,
  UserRound,
  UsersRound,
} from 'lucide-react';

export type SettingsSection = {
  to:
    | '/settings/profile'
    | '/settings/security'
    | '/settings/notifications'
    | '/settings/categories'
    | '/settings/data'
    | '/settings/appearance'
    | '/settings/integrations';
  label: string;
  /** What the section holds, on the phone list. */
  description: string;
  icon: LucideIcon;
};

/** Every Settings section, in list order. A section joins the list when its feature ships. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    to: '/settings/profile',
    label: 'Profile',
    description: 'Name, email, time zone, currency',
    icon: UserRound,
  },
  {
    to: '/settings/security',
    label: 'Security',
    description: 'Password, sessions',
    icon: ShieldCheck,
  },
  {to: '/settings/notifications', label: 'Notifications', description: 'Bank alerts', icon: Bell},
  {
    to: '/settings/categories',
    label: 'Categories',
    description: 'The category list',
    icon: Shapes,
  },
  {to: '/settings/data', label: 'Your data', description: 'Delete your account', icon: Database},
  {to: '/settings/appearance', label: 'Appearance', description: 'Theme', icon: SunMoon},
  {
    to: '/settings/integrations',
    label: 'Integrations',
    description: 'Access tokens, AI assistants',
    icon: Plug,
  },
];

/** Announced sections, listed as disabled "later" rows until they ship. */
export const LATER_SETTINGS_SECTIONS: readonly {label: string; icon: LucideIcon}[] = [
  {label: 'Billing', icon: CreditCard},
  {label: 'Members', icon: UsersRound},
];

/** The section `pathname` is in, if any. */
export function settingsSectionAt(pathname: string) {
  return SETTINGS_SECTIONS.find(
    (section) => pathname === section.to || pathname.startsWith(`${section.to}/`),
  );
}
