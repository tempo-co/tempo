import {BankTransactionCategory} from '@tempo/contracts';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BusFront,
  CircleAlert,
  Clapperboard,
  Gift,
  GraduationCap,
  Hammer,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  Plane,
  ReceiptText,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  TrendingUp,
  Undo2,
  Utensils,
  Wrench,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

import {BANK_TRANSACTION_CATEGORY_LABELS} from '../types/bank-transaction';

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
  HOME_IMPROVEMENT: createCategoryMeta(
    'HOME_IMPROVEMENT',
    Hammer,
    'border-category-home-improvement/30 bg-category-home-improvement/10 text-category-home-improvement',
  ),
  GROCERIES: createCategoryMeta(
    'GROCERIES',
    ShoppingBasket,
    'border-category-groceries/30 bg-category-groceries/10 text-category-groceries',
  ),
  EATING_OUT: createCategoryMeta(
    'EATING_OUT',
    Utensils,
    'border-category-eating-out/30 bg-category-eating-out/10 text-category-eating-out',
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
  HEALTH: createCategoryMeta(
    'HEALTH',
    HeartPulse,
    'border-category-health/30 bg-category-health/10 text-category-health',
  ),
  PERSONAL_CARE: createCategoryMeta(
    'PERSONAL_CARE',
    Scissors,
    'border-category-personal-care/30 bg-category-personal-care/10 text-category-personal-care',
  ),
  ENTERTAINMENT: createCategoryMeta(
    'ENTERTAINMENT',
    Clapperboard,
    'border-category-entertainment/30 bg-category-entertainment/10 text-category-entertainment',
  ),
  TRAVEL: createCategoryMeta(
    'TRAVEL',
    Plane,
    'border-category-travel/30 bg-category-travel/10 text-category-travel',
  ),
  SERVICES: createCategoryMeta(
    'SERVICES',
    Wrench,
    'border-category-services/30 bg-category-services/10 text-category-services',
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
  LOANS_AND_DEBT: createCategoryMeta(
    'LOANS_AND_DEBT',
    HandCoins,
    'border-category-loans-and-debt/30 bg-category-loans-and-debt/10 text-category-loans-and-debt',
  ),
  FEES: createCategoryMeta(
    'FEES',
    ReceiptText,
    'border-category-fees/30 bg-category-fees/10 text-category-fees',
  ),
  TAXES_AND_GOVERNMENT: createCategoryMeta(
    'TAXES_AND_GOVERNMENT',
    Landmark,
    'border-category-taxes-and-government/30 bg-category-taxes-and-government/10 text-category-taxes-and-government',
  ),
  GIFTS_AND_DONATIONS: createCategoryMeta(
    'GIFTS_AND_DONATIONS',
    Gift,
    'border-category-gifts-and-donations/30 bg-category-gifts-and-donations/10 text-category-gifts-and-donations',
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
};
