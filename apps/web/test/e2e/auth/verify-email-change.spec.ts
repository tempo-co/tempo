import {faker} from '@faker-js/faker';
import {UNVERIFIED_USER_AUTH_FILE, VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {invalidEmailChangeVerifySearchParams} from 'test/data/verify-email-change-params.data';

import {expect, test} from '../../fixtures';
import {withSearchParams} from '../../utils/url';

const verifyEmailChangeUrl = (params: object) => withSearchParams('/verify-email-change', params);

test.describe('Email Change Verification', () => {
  test.describe('Invalid search params', () => {
    test.describe('Authenticated + Verified', () => {
      test.use({storageState: VERIFIED_USER_AUTH_FILE});

      test('should redirect to Home with "Invalid or expired verification link" for valid but incorrect params', async ({
        page,
        verifyEmailChangePage,
        homePage,
      }) => {
        await page.goto(
          verifyEmailChangeUrl({email: faker.internet.email(), token: faker.string.uuid()}),
        );

        await expect(verifyEmailChangePage.invalidOrExpiredLinkError).toBeVisible();
        await homePage.expectToBeOnPage();
      });

      for (const {name, params} of invalidEmailChangeVerifySearchParams) {
        test(`should redirect to Home and show "Invalid verification link" with ${name}`, async ({
          page,
          verifyEmailChangePage,
          homePage,
        }) => {
          await page.goto(verifyEmailChangeUrl(params));
          await homePage.expectToBeOnPage();
          await expect(verifyEmailChangePage.invalidLinkToastTitle).toBeVisible();
        });
      }
    });

    test.describe('Authenticated + Unverified', () => {
      test.use({storageState: UNVERIFIED_USER_AUTH_FILE});

      for (const {name, params} of invalidEmailChangeVerifySearchParams) {
        test(`should not navigate away from /verify-email for ${name}`, async ({
          page,
          verifyEmailPage,
        }) => {
          await page.goto(verifyEmailChangeUrl(params));
          await verifyEmailPage.expectToBeOnPage();
        });
      }
    });

    test.describe('Unauthenticated', () => {
      test('should redirect to Login with "Invalid or expired verification link" for valid but incorrect params', async ({
        page,
        verifyEmailChangePage,
        loginPage,
      }) => {
        await page.goto(
          verifyEmailChangeUrl({email: faker.internet.email(), token: faker.string.uuid()}),
        );

        await expect(verifyEmailChangePage.invalidOrExpiredLinkError).toBeVisible();
        await loginPage.expectToBeOnPage();
      });

      for (const {name, params} of invalidEmailChangeVerifySearchParams) {
        test(`should redirect to Login and show "Invalid verification link" with ${name}`, async ({
          page,
          verifyEmailChangePage,
          loginPage,
        }) => {
          await page.goto(verifyEmailChangeUrl(params));
          await loginPage.expectToBeOnPage();
          await expect(verifyEmailChangePage.invalidLinkToastTitle).toBeVisible();
        });
      }
    });
  });
});
