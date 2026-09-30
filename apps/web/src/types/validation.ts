import {z} from 'zod';

export const emailSchema = (requiredMessage = 'Please enter your email address.') =>
  z
    .string()
    .min(1, requiredMessage)
    .max(255, 'Email address must be less than 256 characters.')
    .email('Please enter a valid email address.');

export const passwordSchema = (requiredMessage = 'Please enter your password.') =>
  z
    .string()
    .min(1, requiredMessage)
    .min(8, 'Too short. Must be at least 8 characters.')
    .max(255, 'Too long. Must be less than 256 characters.');

export const nameSchema = z
  .string()
  .min(1, 'Please enter your name.')
  .max(255, 'Name must be less than 256 characters.');
