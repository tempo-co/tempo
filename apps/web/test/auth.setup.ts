import {test as setup} from '@playwright/test';

import {HomePage} from './pages/home.page';
import {LoginPage} from './pages/login.page';
import {VerifyEmailPage} from './pages/verify-email.page';
import {
  EMAIL_CHANGE_ACCOUNT_EMAIL,
  EMAIL_CHANGE_ACCOUNT_PASSWORD,
  EMAIL_CHANGE_USER_AUTH_FILE,
  PW_CHANGE_ACCOUNT_EMAIL,
  PW_CHANGE_ACCOUNT_PASSWORD,
  PW_CHANGE_USER_AUTH_FILE,
  PW_RESET_ACCOUNT_EMAIL,
  PW_RESET_ACCOUNT_PASSWORD,
  PW_RESET_USER_AUTH_FILE,
  SESSION_TEST_ACCOUNT_EMAIL,
  SESSION_TEST_ACCOUNT_PASSWORD,
  SESSION_TEST_USER_AUTH_FILE,
  UNVERIFIED_ACCOUNT_EMAIL,
  UNVERIFIED_ACCOUNT_PASSWORD,
  UNVERIFIED_USER_AUTH_FILE,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
  VERIFIED_USER_AUTH_FILE,
} from './utils/seed.constants';

setup(`authenticate as ${VERIFIED_ACCOUNT_EMAIL}`, async ({page}) => {
  const loginPage = new LoginPage(page);
  const homePage = new HomePage(page);
  await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
  await homePage.expectToBeOnPage();

  await page.context().storageState({path: VERIFIED_USER_AUTH_FILE});
});

setup(`authenticate as ${UNVERIFIED_ACCOUNT_EMAIL}`, async ({page}) => {
  const loginPage = new LoginPage(page);
  const verifyEmailPage = new VerifyEmailPage(page);
  await loginPage.login(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
  await verifyEmailPage.expectToBeOnPage();

  await page.context().storageState({path: UNVERIFIED_USER_AUTH_FILE});
});

setup(`authenticate as ${PW_CHANGE_ACCOUNT_EMAIL}`, async ({page}) => {
  const loginPage = new LoginPage(page);
  const homePage = new HomePage(page);
  await loginPage.login(PW_CHANGE_ACCOUNT_EMAIL, PW_CHANGE_ACCOUNT_PASSWORD);
  await homePage.expectToBeOnPage();

  await page.context().storageState({path: PW_CHANGE_USER_AUTH_FILE});
});

setup(`authenticate as ${PW_RESET_ACCOUNT_EMAIL}`, async ({page}) => {
  const loginPage = new LoginPage(page);
  const homePage = new HomePage(page);
  await loginPage.login(PW_RESET_ACCOUNT_EMAIL, PW_RESET_ACCOUNT_PASSWORD);
  await homePage.expectToBeOnPage();

  await page.context().storageState({path: PW_RESET_USER_AUTH_FILE});
});

setup(`authenticate as ${SESSION_TEST_ACCOUNT_EMAIL}`, async ({page}) => {
  const loginPage = new LoginPage(page);
  const homePage = new HomePage(page);
  await loginPage.login(SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);
  await homePage.expectToBeOnPage();
  await page.context().storageState({path: SESSION_TEST_USER_AUTH_FILE});
});

setup(`authenticate as ${EMAIL_CHANGE_ACCOUNT_EMAIL}`, async ({page}) => {
  const loginPage = new LoginPage(page);
  const homePage = new HomePage(page);
  await loginPage.login(EMAIL_CHANGE_ACCOUNT_EMAIL, EMAIL_CHANGE_ACCOUNT_PASSWORD);
  await homePage.expectToBeOnPage();
  await page.context().storageState({path: EMAIL_CHANGE_USER_AUTH_FILE});
});
