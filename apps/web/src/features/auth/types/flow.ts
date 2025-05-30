export const FLOWS = ['onboarding', 'email-change'] as const;
export type Flow = (typeof FLOWS)[number];
