import {test as setup} from '@playwright/test';

import {
  EMAIL_CHANGE_USER_AUTH_FILE,
  PW_CHANGE_USER_AUTH_FILE,
  PW_RESET_USER_AUTH_FILE,
  SESSION_TEST_USER_AUTH_FILE,
  UNVERIFIED_USER_AUTH_FILE,
  VERIFIED_USER_AUTH_FILE,
} from './constants/auth.constants';
import {
  EMAIL_CHANGE_ACCOUNT_EMAIL,
  EMAIL_CHANGE_ACCOUNT_PASSWORD,
  PW_CHANGE_ACCOUNT_EMAIL,
  PW_CHANGE_ACCOUNT_PASSWORD,
  PW_RESET_ACCOUNT_EMAIL,
  PW_RESET_ACCOUNT_PASSWORD,
  SESSION_TEST_ACCOUNT_EMAIL,
  SESSION_TEST_ACCOUNT_PASSWORD,
  UNVERIFIED_ACCOUNT_EMAIL,
  UNVERIFIED_ACCOUNT_PASSWORD,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
} from './constants/seed.constants';
import {HomePage} from './pages/home.page';
import {LoginPage} from './pages/login.page';
import {VerifyEmailPage} from './pages/verify-email.page';

type LandingPage = 'home' | 'verify-email';

type UserConfig = {
  email: string;
  password: string;
  authFile: string;
  landsOn: LandingPage;
};

const userConfig: UserConfig[] = [
  {
    email: VERIFIED_ACCOUNT_EMAIL,
    password: VERIFIED_ACCOUNT_PASSWORD,
    authFile: VERIFIED_USER_AUTH_FILE,
    landsOn: 'home',
  },
  {
    email: UNVERIFIED_ACCOUNT_EMAIL,
    password: UNVERIFIED_ACCOUNT_PASSWORD,
    authFile: UNVERIFIED_USER_AUTH_FILE,
    landsOn: 'verify-email',
  },
  {
    email: PW_CHANGE_ACCOUNT_EMAIL,
    password: PW_CHANGE_ACCOUNT_PASSWORD,
    authFile: PW_CHANGE_USER_AUTH_FILE,
    landsOn: 'home',
  },
  {
    email: PW_RESET_ACCOUNT_EMAIL,
    password: PW_RESET_ACCOUNT_PASSWORD,
    authFile: PW_RESET_USER_AUTH_FILE,
    landsOn: 'home',
  },
  {
    email: SESSION_TEST_ACCOUNT_EMAIL,
    password: SESSION_TEST_ACCOUNT_PASSWORD,
    authFile: SESSION_TEST_USER_AUTH_FILE,
    landsOn: 'home',
  },
  {
    email: EMAIL_CHANGE_ACCOUNT_EMAIL,
    password: EMAIL_CHANGE_ACCOUNT_PASSWORD,
    authFile: EMAIL_CHANGE_USER_AUTH_FILE,
    landsOn: 'home',
  },
];

for (const {email, password, authFile, landsOn} of userConfig) {
  setup(`authenticate as ${email}`, async ({page}) => {
    const loginPage = new LoginPage(page);
    await loginPage.login(email, password);

    switch (landsOn) {
      case 'home': {
        const homePage = new HomePage(page);
        await homePage.expectToBeOnPage();
        break;
      }
      case 'verify-email': {
        const verifyEmailPage = new VerifyEmailPage(page);
        await verifyEmailPage.expectToBeOnPage();
        break;
      }
    }
    await page.context().storageState({path: authFile});
  });
}
