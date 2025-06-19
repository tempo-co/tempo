import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {UNVERIFIED_USER_AUTH_FILE, VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {invalidEmailChangeVerifySearchParams} from 'test/data/verify-email-change-params.data';
import {HomePage} from 'test/pages/home.page';
import {LoginPage} from 'test/pages/login.page';
import {VerifyEmailChangePage} from 'test/pages/verify-email-change.page';
import {VerifyEmailPage} from 'test/pages/verify-email.page';

test.describe('Email Change Verification', () => {
  let verifyEmailChangePage: VerifyEmailChangePage;
  let loginPage: LoginPage;
  let homePage: HomePage;
  let verifyEmailPage: VerifyEmailPage;

  test.beforeEach(({page}) => {
    verifyEmailChangePage = new VerifyEmailChangePage(page);
    loginPage = new LoginPage(page);
    homePage = new HomePage(page);
    verifyEmailPage = new VerifyEmailPage(page);
  });

  test.describe('Invalid search params', () => {
    test.describe('Authenticated + Verified', () => {
      test.use({storageState: VERIFIED_USER_AUTH_FILE});

      test('should redirect to Home with "Invalid or expired verification link" for valid but incorrect params', async ({
        page,
      }) => {
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
      test.use({storageState: UNVERIFIED_USER_AUTH_FILE});

      for (const testCase of invalidEmailChangeVerifySearchParams) {
        test(`should not navigate away from /verify-email for ${testCase.name}`, async ({page}) => {
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
