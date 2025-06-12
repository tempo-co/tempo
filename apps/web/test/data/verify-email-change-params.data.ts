import {faker} from '@faker-js/faker';

import {EmailChangeVerifySearchParams} from '@/features/auth/types/email-change-verify.dto';

type Params = {
  name: string;
  params: EmailChangeVerifySearchParams | Record<string, string>;
};

export const invalidEmailChangeVerifySearchParams: Array<Params> = [
  {
    name: 'no param',
    params: {},
  },
  {
    name: 'only token param',
    params: {token: faker.string.uuid()},
  },
  {
    name: 'only email param',
    params: {email: faker.internet.email()},
  },
  {
    name: 'token but missing email',
    params: {token: faker.string.uuid()},
  },
  {
    name: 'email but missing token',
    params: {email: faker.internet.email()},
  },
  {
    name: 'email and token but invalid email format',
    params: {email: 'invalid-email', token: faker.string.uuid()},
  },
  {
    name: 'email and token but invalid token format',
    params: {email: faker.internet.email(), token: 'invalid'},
  },
  {
    name: 'unexpected param and missing required ones',
    params: {foo: 'bar'},
  },
  {
    name: 'param with no value (email)',
    params: {email: '', token: faker.string.uuid()},
  },
  {
    name: 'param with no value (token)',
    params: {email: faker.internet.email(), token: ''},
  },
];
