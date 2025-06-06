import {faker} from '@faker-js/faker';

import {EmailVerifySearchParams} from '@/features/auth/types/email-verify.dto';

type Params = {
  name: string;
  params: EmailVerifySearchParams | Record<string, string>;
};

export const invalidVerifyEmailSearchParams: Array<Params> = [
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
    name: 'only flow (onboarding) param',
    params: {flow: 'onboarding'},
  },
  {
    name: 'only flow (email-change) param',
    params: {flow: 'email-change'},
  },
  {
    name: 'code and email, missing flow',
    params: {code: faker.string.numeric(6), email: faker.internet.email()},
  },
  {
    name: 'code and flow, missing email',
    params: {code: faker.string.numeric(6), flow: 'onboarding'},
  },
  {
    name: 'email and flow, missing code',
    params: {email: faker.internet.email(), flow: 'email-change'},
  },
  {
    name: 'all params but invalid email format',
    params: {email: 'invalid-email', code: faker.string.numeric(6), flow: 'onboarding'},
  },
  {
    name: 'all params but invalid code format (non-numeric)',
    params: {email: faker.internet.email(), code: 'abcdef', flow: 'email-change'},
  },
  {
    name: 'all params but invalid code format (wrong length)',
    params: {email: faker.internet.email(), code: '123', flow: 'onboarding'},
  },
  {
    name: 'all params but invalid flow value',
    params: {email: faker.internet.email(), code: faker.string.numeric(6), flow: 'invalidflow'},
  },
  {
    name: 'unexpected param and missing required ones',
    params: {foo: 'bar'},
  },
  {
    name: 'param with no value (email)',
    params: {email: '', code: faker.string.numeric(6), flow: 'onboarding'},
  },
  {
    name: 'param with no value (code)',
    params: {email: faker.internet.email(), code: '', flow: 'email-change'},
  },
  {
    name: 'param with no value (flow)',
    params: {email: faker.internet.email(), code: faker.string.numeric(6), flow: ''},
  },
];
