import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {invalidEmailVerifySearchParams} from 'test/data/verify-email-params.data';
import {HomePage} from 'test/pages/home.page';
import {LoginPage} from 'test/pages/login.page';
import {SignupPage} from 'test/pages/signup.page';
import {VerifyEmailPage} from 'test/pages/verify-email.page';
import {EmailUtils} from 'test/utils/email-utils';
import {
  UNVERIFIED_ACCOUNT_EMAIL,
  UNVERIFIED_ACCOUNT_PASSWORD,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
} from 'test/utils/seed.constants';

test.describe('Email Verification', () => {
  let signupPage: SignupPage;
  let verifyEmailPage: VerifyEmailPage;
  let loginPage: LoginPage;
  let homePage: HomePage;

  test.beforeEach(async ({page}) => {
    signupPage = new SignupPage(page);
    verifyEmailPage = new VerifyEmailPage(page);
    loginPage = new LoginPage(page);
    homePage = new HomePage(page);
    await EmailUtils.clearEmails();
  });

  test.describe.serial('Verify email during signup flow', () => {
    test.beforeEach(async () => {
      await EmailUtils.clearEmails();
    });

    test('should show error for invalid verification code', async () => {
      await signupPage.navigate();
      const email = await signupPage.fillAndSubmitForm();
      const message = await EmailUtils.findEmailByRecipient(email);
      const code = EmailUtils.extractCode(message?.Text);

      const wrongCode = code === '123456' ? '111111' : '123456';
      await verifyEmailPage.inputCodeAndSubmit(wrongCode);
      await expect(verifyEmailPage.invalidOrExpiredCodeError).toBeVisible();
    });

    test('should log out successfully', async ({page}) => {
      await loginPage.login(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
      await verifyEmailPage.expectToBeOnPage();

      await verifyEmailPage.logOutButton.click();
      await loginPage.expectToBeOnPage();
      expect(page.url()).not.toContain('/verify-email');
    });

    test('should resend verification email successfully', async () => {
      await loginPage.login(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
      await verifyEmailPage.expectToBeOnPage();

      await verifyEmailPage.resendCodeButton.click();
      await expect(verifyEmailPage.resendSuccessToastTitle).toBeVisible();
      const emails = await EmailUtils.countEmailsByRecipient(UNVERIFIED_ACCOUNT_EMAIL, 1);
      expect(emails).toBe(1);
    });
  });

  test.describe('Invalid or incorrect search params', () => {
    test.describe('Authenticated + Verified', () => {
      test('should redirect to Home with "Invalid or expired verification link" for valid but incorrect params', async ({
        page,
      }) => {
        await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
        await homePage.expectToBeOnPage();
        const searchParams = new URLSearchParams({email: faker.internet.email(), code: '000000'});
        const verificationUrl = `/verify-email?${searchParams.toString()}`;
        await page.goto(verificationUrl);

        await expect(verifyEmailPage.emailAlreadyVerifiedToast).toBeVisible();
        await homePage.expectToBeOnPage();
      });

      for (const testCase of invalidEmailVerifySearchParams) {
        test(`should redirect to Home with "Invalid verification link" for ${testCase.name}`, async ({
          page,
        }) => {
          await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
          await homePage.expectToBeOnPage();

          const searchParams = new URLSearchParams();
          for (const [key, value] of Object.entries(testCase.params)) {
            searchParams.set(key, String(value));
          }
          const url = `/verify-email?${searchParams.toString()}`;

          await page.goto(url);
          await expect(verifyEmailPage.emailAlreadyVerifiedToast).toBeVisible();
          await homePage.expectToBeOnPage();
        });
      }
    });

    test.describe('Authenticated + Unverified', () => {
      test('should show "Invalid or expired verification link" error for valid but incorrect params', async ({
        page,
      }) => {
        await loginPage.login(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
        await verifyEmailPage.expectToBeOnPage();
        const searchParams = new URLSearchParams({email: faker.internet.email(), code: '000000'});
        const verificationUrl = `/verify-email?${searchParams.toString()}`;
        await page.goto(verificationUrl);

        await expect(verifyEmailPage.invalidOrExpiredLinkError).toBeVisible();

        await verifyEmailPage.resendCodeButton.click();
        await expect(verifyEmailPage.resendSuccessToastTitle).toBeVisible();
        await verifyEmailPage.expectToBeOnPage();
      });

      for (const testCase of invalidEmailVerifySearchParams) {
        test(`should not navigate away from /verify-email for ${testCase.name}`, async ({page}) => {
          await loginPage.login(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
          await verifyEmailPage.expectToBeOnPage();

          const searchParams = new URLSearchParams();
          for (const [key, value] of Object.entries(testCase.params)) {
            searchParams.set(key, String(value));
          }
          const url = `/verify-email?${searchParams.toString()}`;

          await page.goto(url);
          await verifyEmailPage.expectToBeOnPage();
        });
      }
    });

    test.describe('Unauthenticated', () => {
      test('should redirect to Login with "Invalid or expired verification link" for valid but incorrect params', async ({
        page,
      }) => {
        const params = new URLSearchParams({
          email: faker.internet.email(),
          code: faker.string.numeric(6),
        });
        await page.goto(`/verify-email?${params.toString()}`);

        await expect(verifyEmailPage.invalidOrExpiredLinkError).toBeVisible();
        await verifyEmailPage.logInButton.click();
        await loginPage.expectToBeOnPage();
      });

      for (const testCase of invalidEmailVerifySearchParams) {
        test(`should redirect to Login with "Invalid verification link" for ${testCase.name}`, async ({
          page,
        }) => {
          const searchParams = new URLSearchParams();
          for (const [key, value] of Object.entries(testCase.params)) {
            searchParams.set(key, String(value));
          }
          const url = `/verify-email?${searchParams.toString()}`;

          await page.goto(url);
          await loginPage.expectToBeOnPage();
          await expect(verifyEmailPage.invalidLinkToastTitle).toBeVisible();
        });
      }
    });
  });
});
