import {faker} from '@faker-js/faker';
import {UNVERIFIED_USER_AUTH_FILE, VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {invalidEmailChangeVerifySearchParams} from 'test/data/verify-email-change-params.data';

import {createVerifiedAccount, expect, test} from '../../fixtures';
import {withSearchParams} from '../../utils/url';

const verifyEmailChangeUrl = (params: object) => withSearchParams('/verify-email-change', params);

test.describe('Email Change Verification', () => {
  test.describe('Invalid search params', () => {
    test.describe('Authenticated + Verified', () => {
      test.use({storageState: VERIFIED_USER_AUTH_FILE});

      test('should redirect to Account settings with "Invalid or expired verification link" for valid but incorrect params', async ({
        page,
        verifyEmailChangePage,
        accountSettingsPage,
      }) => {
        await page.goto(
          verifyEmailChangeUrl({email: faker.internet.email(), token: faker.string.uuid()}),
        );

        await expect(verifyEmailChangePage.invalidOrExpiredLinkError).toBeVisible();
        await accountSettingsPage.expectToBeOnPage();
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
      test('should ask to log in and keep the link to resume afterwards', async ({
        page,
        verifyEmailChangePage,
      }) => {
        const params = {email: faker.internet.email().toLowerCase(), token: faker.string.uuid()};
        await page.goto(verifyEmailChangeUrl(params));

        await expect(verifyEmailChangePage.loginRequiredToast).toBeVisible();
        await page.waitForURL((url) => url.pathname === '/login');
        const redirect = new URL(page.url()).searchParams.get('redirect');
        expect(redirect).toBe(verifyEmailChangeUrl(params));
      });

      test('should ignore an off-site redirect after login', async ({page, loginPage}) => {
        const account = await createVerifiedAccount(page.request);
        await page.context().clearCookies();

        await page.goto('/login?redirect=%2F%2Fevil.example%2Fsteal');
        await loginPage.emailInput.fill(account.email);
        await loginPage.passwordInput.fill(account.password);
        await loginPage.submitButton.click();

        await page.waitForURL('/');
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
