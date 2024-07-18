import {Category} from './category';

export type Transaction = {
  id: string;
  startedDate: Date;
  completedDate: Date;
  description: string;
  amount: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  category: Category;
};
