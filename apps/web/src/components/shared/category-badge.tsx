import {
  Car,
  CircleHelp,
  Drama,
  HandCoins,
  HousePlug,
  LucideProps,
  MoveDownLeft,
  MoveUpRight,
  ShoppingBag,
  Stethoscope,
  Utensils,
} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Category} from '@/types/category';
import {cn} from '@/utils/cn';

type LucideIcon = React.ForwardRefExoticComponent<
  Omit<LucideProps, 'ref'> & React.RefAttributes<SVGSVGElement>
>;

type CategoryProps = {
  icon: LucideIcon;
  className: string;
  label: string;
};

const categories: Record<Category, CategoryProps> = {
  RENT_AND_UTILITIES: {
    icon: HousePlug,
    className: 'bg-blue-100 dark:bg-blue-900/50 dark:border-blue-900/50',
    label: 'Rent and Utilities',
  },
  FOOD_AND_DRINK: {
    icon: Utensils,
    className: 'bg-red-100 dark:bg-red-900/50 dark:border-red-900/50',
    label: 'Food and Drink',
  },
  GENERAL_MERCHANDISE: {
    icon: ShoppingBag,
    className: 'bg-yellow-100 dark:bg-yellow-900/50 dark:border-yellow-900/50',
    label: 'General Merchandise',
  },
  TRANSPORTATION: {
    icon: Car,
    className: 'bg-green-100 dark:bg-green-900/50 dark:border-green-900/50',
    label: 'Transportation',
  },
  ENTERTAINMENT: {
    icon: Drama,
    className: 'bg-purple-100 dark:bg-purple-900/50 dark:border-purple-900/50',
    label: 'Entertainment',
  },
  MEDICAL: {
    icon: Stethoscope,
    className: 'bg-pink-100 dark:bg-pink-900/50 dark:border-pink-900/50',
    label: 'Medical',
  },
  INCOME: {
    icon: HandCoins,
    className: 'bg-indigo-100 dark:bg-indigo-900/50 dark:border-indigo-900/50',
    label: 'Income',
  },
  TRANSFER_IN: {
    icon: MoveUpRight,
    className: 'bg-teal-100 dark:bg-teal-900/50 dark:border-teal-900/50',
    label: 'Transfer In',
  },
  TRANSFER_OUT: {
    icon: MoveDownLeft,
    className: 'bg-orange-100 dark:bg-orange-900/50 dark:border-orange-900/50',
    label: 'Transfer Out',
  },
  OTHER: {
    icon: CircleHelp,
    className: 'bg-gray-100 dark:bg-gray-700/50 dark:border-gray-700/50',
    label: 'Other',
  },
};

type CategoryBadgeProps = {
  category: Category;
};

export function CategoryBadge({category}: CategoryBadgeProps) {
  const badge = categories[category] || categories[Category.OTHER];

  return (
    <Badge variant='outline' className={cn('whitespace-nowrap text-foreground', badge.className)}>
      <badge.icon className='mr-1 h-4 w-4'></badge.icon>
      {badge.label}
    </Badge>
  );
}
