import {faker} from '@faker-js/faker';
import {UNVERIFIED_USER_AUTH_FILE, VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {UNVERIFIED_ACCOUNT_EMAIL} from 'test/constants/seed.constants';
import {invalidEmailVerifySearchParams} from 'test/data/verify-email-params.data';
import {EmailUtils} from 'test/utils/email-utils';

import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';
import {withSearchParams} from '../../utils/url';

const verifyEmailUrl = (params: object) => withSearchParams('/verify-email', params);

test.describe('Email Verification', () => {
  test.describe('Verification request errors', () => {
    test('should show a retry state instead of an indefinite spinner', async ({page}) => {
      let attempts = 0;
      await page.route('**/auth/signup/verify', async (route) => {
        attempts++;
        await fulfillJson(route, {message: 'Verification service unavailable'}, 500);
      });

      await page.goto(verifyEmailUrl({email: 'retry@test.com', code: '123456'}));

      await expect(page.getByRole('heading', {name: 'Verification failed'})).toBeVisible();
      await expect(page.getByTestId('retry-verification-button')).toBeVisible();
      await expect(page.getByRole('heading', {name: 'Verifying your email...'})).toHaveCount(0);
      await expect(page.getByRole('link', {name: 'Log in instead'})).toBeVisible();

      const attemptsBeforeRetry = attempts;
      await page.getByTestId('retry-verification-button').click();
      await expect(page.getByRole('heading', {name: 'Verification failed'})).toBeVisible();
      expect(attempts).toBeGreaterThan(attemptsBeforeRetry);
    });
  });

  test.describe('Signup Flow', () => {
    test('should show error for invalid verification code', async ({
      signupPage,
      verifyEmailPage,
    }) => {
      await EmailUtils.clearEmails();
      await signupPage.navigate();
      const email = await signupPage.fillAndSubmitForm();
      const code = await EmailUtils.getVerificationCode(email);

      const wrongCode = code === '123456' ? '111111' : '123456';
      await verifyEmailPage.inputCodeAndSubmit(wrongCode);
      await expect(verifyEmailPage.invalidOrExpiredCodeError).toBeVisible();
    });
  });

  test.describe('Invalid URL Search Params', () => {
    test.describe('Authenticated + Verified', () => {
      test.use({storageState: VERIFIED_USER_AUTH_FILE});

      test('should redirect to Home with "already been verified" toast for valid but incorrect params', async ({
        page,
        verifyEmailPage,
        homePage,
      }) => {
        await page.goto(verifyEmailUrl({email: faker.internet.email(), code: '000000'}));

        await expect(verifyEmailPage.emailAlreadyVerifiedToast).toBeVisible();
        await homePage.expectToBeOnPage();
      });

      for (const {name, params} of invalidEmailVerifySearchParams) {
        test(`should redirect to Home with "already been verified" for ${name}`, async ({
          page,
          verifyEmailPage,
          homePage,
        }) => {
          await page.goto(verifyEmailUrl(params));
          await expect(verifyEmailPage.emailAlreadyVerifiedToast).toBeVisible();
          await homePage.expectToBeOnPage();
        });
      }
    });

    test.describe('Authenticated + Unverified', () => {
      test.use({storageState: UNVERIFIED_USER_AUTH_FILE});

      test('should show "Invalid or expired verification link" error for valid but incorrect params', async ({
        page,
        verifyEmailPage,
      }) => {
        await page.goto(verifyEmailUrl({email: faker.internet.email(), code: '000000'}));

        await expect(verifyEmailPage.invalidOrExpiredLinkError).toBeVisible();

        await verifyEmailPage.resendCodeButton.click();
        await expect(verifyEmailPage.resendSuccessToastTitle).toBeVisible();
        await verifyEmailPage.expectToBeOnPage();
      });

      for (const {name, params} of invalidEmailVerifySearchParams) {
        test(`should not navigate away from /verify-email for ${name}`, async ({
          page,
          verifyEmailPage,
        }) => {
          await page.goto(verifyEmailUrl(params));
          await verifyEmailPage.expectToBeOnPage();
        });
      }
    });

    test.describe('Unauthenticated', () => {
      test('should redirect to Login with "Invalid or expired verification link" for valid but incorrect params', async ({
        page,
        verifyEmailPage,
        loginPage,
      }) => {
        await page.goto(
          verifyEmailUrl({email: faker.internet.email(), code: faker.string.numeric(6)}),
        );

        await expect(verifyEmailPage.invalidOrExpiredLinkError).toBeVisible();
        await verifyEmailPage.logInButton.click();
        await loginPage.expectToBeOnPage();
      });

      for (const {name, params} of invalidEmailVerifySearchParams) {
        test(`should redirect to Login with "Invalid verification link" for ${name}`, async ({
          page,
          verifyEmailPage,
          loginPage,
        }) => {
          await page.goto(verifyEmailUrl(params));
          await loginPage.expectToBeOnPage();
          await expect(verifyEmailPage.invalidLinkToastTitle).toBeVisible();
        });
      }
    });

    test.describe.serial('Page Actions (Authenticated + Unverified)', () => {
      test.use({storageState: UNVERIFIED_USER_AUTH_FILE});

      test.beforeEach(async ({page, verifyEmailPage}) => {
        await page.goto('/verify-email');
        await verifyEmailPage.expectToBeOnPage();
      });

      test('should resend verification email successfully', async ({verifyEmailPage}) => {
        await EmailUtils.clearEmails();
        await verifyEmailPage.resendCodeButton.click();
        await expect(verifyEmailPage.resendSuccessToastTitle).toBeVisible();
        const emails = await EmailUtils.countEmailsByRecipient(UNVERIFIED_ACCOUNT_EMAIL, 1);
        expect(emails).toBe(1);
      });

      test('should log out successfully', async ({page, verifyEmailPage, loginPage}) => {
        await verifyEmailPage.logOutButton.click();
        await loginPage.expectToBeOnPage();
        expect(page.url()).not.toContain('/verify-email');
      });
    });
  });
});
