import {
  Car,
  CircleHelp,
  Drama,
  HandCoins,
  HousePlug,
  MoveDownLeft,
  MoveUpRight,
  ShoppingBag,
  Stethoscope,
  Utensils,
} from 'lucide-react';
import {useMemo} from 'react';

import {Badge} from '@/components/ui/badge';
import {Category} from '@/types/category';
import {cn} from '@/utils/cn';

type CategoryDetail = {
  icon: JSX.Element;
  bgColor: string;
  label: string;
};

const categoryDetails: Record<Category, CategoryDetail> = {
  RENT_AND_UTILITIES: {
    icon: <HousePlug className='mr-1 h-4 w-4' />,
    bgColor: 'bg-blue-100 dark:bg-blue-900/50 dark:border-blue-900/50',
    label: 'Rent and Utilities',
  },
  FOOD_AND_DRINK: {
    icon: <Utensils className='mr-1 h-4 w-4' />,
    bgColor: 'bg-red-100 dark:bg-red-900/50 dark:border-red-900/50',
    label: 'Food and Drink',
  },
  GENERAL_MERCHANDISE: {
    icon: <ShoppingBag className='mr-1 h-4 w-4' />,
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/50 dark:border-yellow-900/50',
    label: 'General Merchandise',
  },
  TRANSPORTATION: {
    icon: <Car className='mr-1 h-4 w-4' />,
    bgColor: 'bg-green-100 dark:bg-green-900/50 dark:border-green-900/50',
    label: 'Transportation',
  },
  ENTERTAINMENT: {
    icon: <Drama className='mr-1 h-4 w-4' />,
    bgColor: 'bg-purple-100 dark:bg-purple-900/50 dark:border-purple-900/50',
    label: 'Entertainment',
  },
  MEDICAL: {
    icon: <Stethoscope className='mr-1 h-4 w-4' />,
    bgColor: 'bg-pink-100 dark:bg-pink-900/50 dark:border-pink-900/50',
    label: 'Medical',
  },
  INCOME: {
    icon: <HandCoins className='mr-1 h-4 w-4' />,
    bgColor: 'bg-indigo-100 dark:bg-indigo-900/50 dark:border-indigo-900/50',
    label: 'Income',
  },
  TRANSFER_IN: {
    icon: <MoveUpRight className='mr-1 h-4 w-4' />,
    bgColor: 'bg-teal-100 dark:bg-teal-900/50 dark:border-teal-900/50',
    label: 'Transfer In',
  },
  TRANSFER_OUT: {
    icon: <MoveDownLeft className='mr-1 h-4 w-4' />,
    bgColor: 'bg-orange-100 dark:bg-orange-900/50 dark:border-orange-900/50',
    label: 'Transfer Out',
  },
  OTHER: {
    icon: <CircleHelp className='mr-1 h-4 w-4' />,
    bgColor: 'bg-gray-100 dark:bg-gray-700/50 dark:border-gray-700/50',
    label: 'Other',
  },
};

type CategoryBadgeProps = {
  category: Category;
};

export function CategoryBadge({category}: CategoryBadgeProps) {
  const {icon, bgColor, label} = useMemo(
    () => categoryDetails[category] || categoryDetails[Category.OTHER],
    [category],
  );

  return (
    <Badge variant='outline' className={cn('whitespace-nowrap text-foreground', bgColor)}>
      {icon}
      {label}
    </Badge>
  );
}
