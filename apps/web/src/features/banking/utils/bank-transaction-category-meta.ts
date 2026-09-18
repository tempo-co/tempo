import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BusFront,
  CircleAlert,
  CircleHelp,
  Clapperboard,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Plane,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Undo2,
  Utensils,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

import {BANK_TRANSACTION_CATEGORY_LABELS, BankTransactionCategory} from '../types/bank-transaction';

export type BankTransactionCategoryMeta = {
  label: string;
  icon: LucideIcon;
  colorClassName: string;
};

function createCategoryMeta(
  category: BankTransactionCategory,
  icon: LucideIcon,
  colorClassName: string,
): BankTransactionCategoryMeta {
  return {
    label: BANK_TRANSACTION_CATEGORY_LABELS[category],
    icon,
    colorClassName,
  };
}

export const BANK_TRANSACTION_CATEGORY_META: Record<
  BankTransactionCategory,
  BankTransactionCategoryMeta
> = {
  HOUSING_AND_UTILITIES: createCategoryMeta(
    'HOUSING_AND_UTILITIES',
    House,
    'border-category-housing/30 bg-category-housing/10 text-category-housing',
  ),
  FOOD_AND_DRINK: createCategoryMeta(
    'FOOD_AND_DRINK',
    Utensils,
    'border-category-food-and-drink/30 bg-category-food-and-drink/10 text-category-food-and-drink',
  ),
  TRANSPORTATION: createCategoryMeta(
    'TRANSPORTATION',
    BusFront,
    'border-category-transportation/30 bg-category-transportation/10 text-category-transportation',
  ),
  SHOPPING: createCategoryMeta(
    'SHOPPING',
    ShoppingBag,
    'border-category-shopping/30 bg-category-shopping/10 text-category-shopping',
  ),
  SUBSCRIPTIONS: createCategoryMeta(
    'SUBSCRIPTIONS',
    RefreshCw,
    'border-category-subscriptions/30 bg-category-subscriptions/10 text-category-subscriptions',
  ),
  HEALTH: createCategoryMeta(
    'HEALTH',
    HeartPulse,
    'border-category-health/30 bg-category-health/10 text-category-health',
  ),
  TRAVEL: createCategoryMeta(
    'TRAVEL',
    Plane,
    'border-category-travel/30 bg-category-travel/10 text-category-travel',
  ),
  ENTERTAINMENT: createCategoryMeta(
    'ENTERTAINMENT',
    Clapperboard,
    'border-category-entertainment/30 bg-category-entertainment/10 text-category-entertainment',
  ),
  PERSONAL_CARE: createCategoryMeta(
    'PERSONAL_CARE',
    Sparkles,
    'border-category-personal-care/30 bg-category-personal-care/10 text-category-personal-care',
  ),
  EDUCATION: createCategoryMeta(
    'EDUCATION',
    GraduationCap,
    'border-category-education/30 bg-category-education/10 text-category-education',
  ),
  INSURANCE: createCategoryMeta(
    'INSURANCE',
    ShieldCheck,
    'border-category-insurance/30 bg-category-insurance/10 text-category-insurance',
  ),
  TAXES: createCategoryMeta(
    'TAXES',
    Landmark,
    'border-category-taxes/30 bg-category-taxes/10 text-category-taxes',
  ),
  FEES: createCategoryMeta(
    'FEES',
    ReceiptText,
    'border-category-fees/30 bg-category-fees/10 text-category-fees',
  ),
  CASH_WITHDRAWAL: createCategoryMeta(
    'CASH_WITHDRAWAL',
    Banknote,
    'border-category-cash-withdrawal/30 bg-category-cash-withdrawal/10 text-category-cash-withdrawal',
  ),
  INCOME: createCategoryMeta(
    'INCOME',
    TrendingUp,
    'border-category-income/30 bg-category-income/10 text-category-income',
  ),
  REFUND: createCategoryMeta(
    'REFUND',
    Undo2,
    'border-category-refund/30 bg-category-refund/10 text-category-refund',
  ),
  TRANSFER_IN: createCategoryMeta(
    'TRANSFER_IN',
    ArrowDownLeft,
    'border-category-transfer-in/30 bg-category-transfer-in/10 text-category-transfer-in',
  ),
  TRANSFER_OUT: createCategoryMeta(
    'TRANSFER_OUT',
    ArrowUpRight,
    'border-category-transfer-out/30 bg-category-transfer-out/10 text-category-transfer-out',
  ),
  NEEDS_REVIEW: createCategoryMeta(
    'NEEDS_REVIEW',
    CircleAlert,
    'border-muted-foreground/30 bg-muted text-muted-foreground',
  ),
  OTHER: createCategoryMeta(
    'OTHER',
    CircleHelp,
    'border-category-other/30 bg-category-other/10 text-category-other',
  ),
};
