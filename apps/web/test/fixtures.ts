import {faker} from '@faker-js/faker';
import {APIRequestContext, test as base, expect} from '@playwright/test';
import {loadEnv} from 'vite';

import {AccountSettingsPage} from './pages/account-settings.page';
import {AppearanceSettingsPage} from './pages/appearance-settings.page';
import {HomePage} from './pages/home.page';
import {LoginPage} from './pages/login.page';
import {ResetPasswordPage} from './pages/reset-password.page';
import {SecuritySettingsPage} from './pages/security-settings.page';
import {SignupPage} from './pages/signup.page';
import {VerifyEmailChangePage} from './pages/verify-email-change.page';
import {VerifyEmailPage} from './pages/verify-email.page';
import {EmailUtils} from './utils/email-utils';

export const API_URL = loadEnv('development', process.cwd(), '').VITE_API_URL;

export type TestAccount = {name: string; email: string; password: string};

/**
 * Signs up a new account and verifies it through the API and Mailpit. Tests that change account
 * data or need an account without bank data use this instead of a shared seeded account, so they
 * do not depend on test order and stay safe to retry.
 */
export async function createVerifiedAccount(request: APIRequestContext): Promise<TestAccount> {
  const account = {
    name: faker.person.fullName(),
    email: faker.internet.email().toLowerCase(),
    password: faker.internet.password({length: 12}),
  };
  const signup = await request.post(`${API_URL}/auth/signup`, {data: account});
  expect(signup.status()).toBe(201);

  const code = await EmailUtils.getVerificationCode(account.email);
  const verify = await request.post(`${API_URL}/auth/signup/verify`, {
    data: {email: account.email, code},
  });
  expect(verify.status()).toBe(200);

  return account;
}

type Fixtures = {
  /** A new verified account without bank data; the test's browser context is logged in as it. */
  freshAccount: TestAccount;
  accountSettingsPage: AccountSettingsPage;
  appearanceSettingsPage: AppearanceSettingsPage;
  homePage: HomePage;
  loginPage: LoginPage;
  resetPasswordPage: ResetPasswordPage;
  securitySettingsPage: SecuritySettingsPage;
  signupPage: SignupPage;
  verifyEmailChangePage: VerifyEmailChangePage;
  verifyEmailPage: VerifyEmailPage;
};

export const test = base.extend<Fixtures>({
  accountSettingsPage: async ({page}, provide) => provide(new AccountSettingsPage(page)),
  appearanceSettingsPage: async ({page}, provide) => provide(new AppearanceSettingsPage(page)),
  homePage: async ({page}, provide) => provide(new HomePage(page)),
  loginPage: async ({page}, provide) => provide(new LoginPage(page)),
  resetPasswordPage: async ({page}, provide) => provide(new ResetPasswordPage(page)),
  securitySettingsPage: async ({page}, provide) => provide(new SecuritySettingsPage(page)),
  signupPage: async ({page}, provide) => provide(new SignupPage(page)),
  verifyEmailChangePage: async ({page}, provide) => provide(new VerifyEmailChangePage(page)),
  verifyEmailPage: async ({page}, provide) => provide(new VerifyEmailPage(page)),
  freshAccount: async ({page}, provide) => {
    const account = await createVerifiedAccount(page.request);
    const login = await page.request.post(`${API_URL}/auth/login`, {
      data: {email: account.email, password: account.password},
    });
    expect(login.status()).toBe(200);
    await provide(account);
  },
});

export {expect};
