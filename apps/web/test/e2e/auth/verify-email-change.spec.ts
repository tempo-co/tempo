import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {invalidEmailChangeVerifySearchParams} from 'test/data/verify-email-change-params.data';
import {HomePage} from 'test/pages/home.page';
import {LoginPage} from 'test/pages/login.page';
import {VerifyEmailChangePage} from 'test/pages/verify-email-change.page';
import {VerifyEmailPage} from 'test/pages/verify-email.page';
import {EmailUtils} from 'test/utils/email-utils';
import {
  UNVERIFIED_ACCOUNT_EMAIL,
  UNVERIFIED_ACCOUNT_PASSWORD,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
} from 'test/utils/seed.constants';

test.describe('Email Change Verification', () => {
  let verifyEmailChangePage: VerifyEmailChangePage;
  let loginPage: LoginPage;
  let homePage: HomePage;
  let verifyEmailPage: VerifyEmailPage;

  test.beforeEach(async ({page}) => {
    verifyEmailChangePage = new VerifyEmailChangePage(page);
    loginPage = new LoginPage(page);
    homePage = new HomePage(page);
    verifyEmailPage = new VerifyEmailPage(page);

    await EmailUtils.clearEmails();
  });

  test.describe('Invalid search params', () => {
    test.describe('Authenticated + Verified', () => {
      test('should redirect to Home with "Invalid or expired verification link" for valid but incorrect params', async ({
        page,
      }) => {
        await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
        await homePage.expectToBeOnPage();
        const searchParams = new URLSearchParams({
          email: faker.internet.email(),
          token: faker.string.uuid(),
        });
        const verificationUrl = `/verify-email-change?${searchParams.toString()}`;
        await page.goto(verificationUrl);

        await expect(verifyEmailChangePage.invalidOrExpiredLinkError).toBeVisible();
        await homePage.expectToBeOnPage();
      });

      for (const testCase of invalidEmailChangeVerifySearchParams) {
        test(`should redirect to Home and show "Invalid verification link" with ${testCase.name}`, async ({
          page,
        }) => {
          await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
          await homePage.expectToBeOnPage();

          const searchParams = new URLSearchParams();
          for (const [key, value] of Object.entries(testCase.params)) {
            searchParams.set(key, String(value));
          }
          const url = `/verify-email-change?${searchParams.toString()}`;

          await page.goto(url);
          await homePage.expectToBeOnPage();
          await expect(verifyEmailChangePage.invalidLinkToastTitle).toBeVisible();
        });
      }
    });

    test.describe('Authenticated + Unverified', () => {
      for (const testCase of invalidEmailChangeVerifySearchParams) {
        test(`should not navigate away from /verify-email for ${testCase.name}`, async ({page}) => {
          await loginPage.login(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
          await verifyEmailPage.expectToBeOnPage();

          const searchParams = new URLSearchParams();
          for (const [key, value] of Object.entries(testCase.params)) {
            searchParams.set(key, String(value));
          }
          const url = `/verify-email-change?${searchParams.toString()}`;

          await page.goto(url);
          await verifyEmailPage.expectToBeOnPage();
        });
      }
    });

    test.describe('Unauthenticated', () => {
      test('should redirect to Login with "Invalid or expired verification link" for valid but incorrect params', async ({
        page,
      }) => {
        const searchParams = new URLSearchParams({
          email: faker.internet.email(),
          token: faker.string.uuid(),
        });
        const verificationUrl = `/verify-email-change?${searchParams.toString()}`;
        await page.goto(verificationUrl);

        await expect(verifyEmailChangePage.invalidOrExpiredLinkError).toBeVisible();
        await loginPage.expectToBeOnPage();
      });

      for (const testCase of invalidEmailChangeVerifySearchParams) {
        test(`should redirect to Login and show "Invalid verification link" with ${testCase.name}`, async ({
          page,
        }) => {
          const searchParams = new URLSearchParams();
          for (const [key, value] of Object.entries(testCase.params)) {
            searchParams.set(key, String(value));
          }
          const url = `/verify-email-change?${searchParams.toString()}`;

          await page.goto(url);
          await loginPage.expectToBeOnPage();
          await expect(verifyEmailChangePage.invalidLinkToastTitle).toBeVisible();
        });
      }
    });
  });
});
