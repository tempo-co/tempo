import {faker} from '@faker-js/faker';

import {EmailVerifySearchParams} from '@/features/auth/types/email-verify.dto';

type Params = {
  name: string;
  params: EmailVerifySearchParams | Record<string, string>;
};

export const invalidEmailVerifySearchParams: Array<Params> = [
  {
    name: 'no param',
    params: {},
  },
  {
    name: 'only code param',
    params: {code: faker.string.numeric(6)},
  },
  {
    name: 'only email param',
    params: {email: faker.internet.email()},
  },
  {
    name: 'code but missing email',
    params: {code: faker.string.numeric(6)},
  },
  {
    name: 'email but missing code',
    params: {email: faker.internet.email()},
  },
  {
    name: 'email and code but invalid email format',
    params: {email: 'invalid-email', code: faker.string.numeric(6)},
  },
  {
    name: 'email and code but invalid code format (non-numeric)',
    params: {email: faker.internet.email(), code: 'abcdef'},
  },
  {
    name: 'email and code but invalid code format (wrong length)',
    params: {email: faker.internet.email(), code: '123'},
  },
  {
    name: 'unexpected param and missing required ones',
    params: {foo: 'bar'},
  },
  {
    name: 'param with no value (email)',
    params: {email: '', code: faker.string.numeric(6)},
  },
  {
    name: 'param with no value (code)',
    params: {email: faker.internet.email(), code: ''},
  },
];
