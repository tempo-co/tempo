import {faker} from '@faker-js/faker';
import {PW_CHANGE_ACCOUNT_EMAIL} from 'test/utils/seed.constants';

import {PasswordResetSearchParams} from '@/features/auth/types/token.dto';

type Params = {
  name: string;
  params: PasswordResetSearchParams & {
    [key: string]: string | undefined;
  };
};

export const invalidResetPasswordSearchParams: Array<Params> = [
  {
    name: 'token is missing from URL',
    params: {email: PW_CHANGE_ACCOUNT_EMAIL},
  },
  {
    name: 'email is missing from URL',
    params: {token: faker.string.uuid()},
  },
  {
    name: 'token is not a valid UUID in URL',
    params: {token: 'not-a-valid-uuid', email: PW_CHANGE_ACCOUNT_EMAIL},
  },
  {
    name: 'email format is invalid in URL',
    params: {token: faker.string.uuid(), email: 'not-an-email-address'},
  },
  {
    name: 'token is empty in URL',
    params: {token: '', email: PW_CHANGE_ACCOUNT_EMAIL},
  },
  {
    name: 'email is empty in URL',
    params: {token: faker.string.uuid(), email: ''},
  },
  {
    name: 'no params (navigating to /reset-password)',
    params: {},
  },
  {
    name: 'unexpected parameter and missing required ones',
    params: {foo: 'bar'},
  },
];
