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
  UNVERIFIED_USER_AUTH_FILE,
  VERIFIED_USER_AUTH_FILE,
} from 'test/utils/seed.constants';

test.describe('Email Verification', () => {
  test.describe('Signup Flow', () => {
    let signupPage: SignupPage;
    let verifyEmailPage: VerifyEmailPage;

    test.beforeEach(async ({page}) => {
      signupPage = new SignupPage(page);
      verifyEmailPage = new VerifyEmailPage(page);
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
  });

  test.describe('Invalid URL Search Params', () => {
    test.describe('Authenticated + Verified', () => {
      test.use({storageState: VERIFIED_USER_AUTH_FILE});
      let verifyEmailPage: VerifyEmailPage;
      let homePage: HomePage;

      test.beforeEach(({page}) => {
        verifyEmailPage = new VerifyEmailPage(page);
        homePage = new HomePage(page);
      });

      test('should redirect to Home with "already been verified" toast for valid but incorrect params', async ({
        page,
      }) => {
        const searchParams = new URLSearchParams({email: faker.internet.email(), code: '000000'});
        const verificationUrl = `/verify-email?${searchParams.toString()}`;
        await page.goto(verificationUrl);

        await expect(verifyEmailPage.emailAlreadyVerifiedToast).toBeVisible();
        await homePage.expectToBeOnPage();
      });

      for (const testCase of invalidEmailVerifySearchParams) {
        test(`should redirect to Home with "already been verified" for ${testCase.name}`, async ({
          page,
        }) => {
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
      test.use({storageState: UNVERIFIED_USER_AUTH_FILE});
      let verifyEmailPage: VerifyEmailPage;

      test.beforeEach(({page}) => {
        verifyEmailPage = new VerifyEmailPage(page);
      });

      test('should show "Invalid or expired verification link" error for valid but incorrect params', async ({
        page,
      }) => {
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
      let verifyEmailPage: VerifyEmailPage;
      let loginPage: LoginPage;

      test.beforeEach(({page}) => {
        verifyEmailPage = new VerifyEmailPage(page);
        loginPage = new LoginPage(page);
      });

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

    test.describe.serial('Page Actions (Authenticated + Unverified)', () => {
      test.use({storageState: UNVERIFIED_USER_AUTH_FILE});

      let verifyEmailPage: VerifyEmailPage;
      let loginPage: LoginPage;

      test.beforeEach(async ({page}) => {
        verifyEmailPage = new VerifyEmailPage(page);
        loginPage = new LoginPage(page);
        await page.goto('/verify-email');
        await verifyEmailPage.expectToBeOnPage();
      });

      test('should resend verification email successfully', async () => {
        await EmailUtils.clearEmails();
        await verifyEmailPage.resendCodeButton.click();
        await expect(verifyEmailPage.resendSuccessToastTitle).toBeVisible();
        const emails = await EmailUtils.countEmailsByRecipient(UNVERIFIED_ACCOUNT_EMAIL, 1);
        expect(emails).toBe(1);
      });

      test('should log out successfully', async ({page}) => {
        await verifyEmailPage.logOutButton.click();
        await loginPage.expectToBeOnPage();
        expect(page.url()).not.toContain('/verify-email');
      });
    });
  });
});
