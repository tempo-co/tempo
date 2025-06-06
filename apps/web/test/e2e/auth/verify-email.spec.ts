import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {invalidVerifyEmailSearchParams} from 'test/data/verify-email-params.data';
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

  test.describe('Onboarding flow', () => {
    test('should show error for invalid verification code', async () => {
      await signupPage.navigate();
      const email = await signupPage.fillAndSubmitForm();
      const message = await EmailUtils.findEmailByRecipient(email);
      const code = EmailUtils.extractCode(message?.Text);

      const wrongCode = code === '123456' ? '111111' : '123456';
      await verifyEmailPage.inputCodeAndSubmit(wrongCode);
      await expect(verifyEmailPage.invalidOrExpiredCodeError).toBeVisible();
    });

    test('should redirect to /verify-email after logging in with an unverified account', async () => {
      await loginPage.navigate();
      await loginPage.login(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
      await verifyEmailPage.expectToBeOnPage();
    });
  });

  test.describe('Email Change Flow', () => {
    test('should redirect unauthenticated user to Login and show toast', async ({page}) => {
      const params = new URLSearchParams({
        flow: 'email-change',
        email: faker.internet.email(),
        code: faker.string.numeric(6),
      });
      await page.goto(`/verify-email?${params.toString()}`);

      await loginPage.expectToBeOnPage();
      await expect(verifyEmailPage.emailChangeLoginRequiredToast).toBeVisible();
    });
  });

  test.describe('Invalid search params', () => {
    test.describe('Authenticated + Verified', () => {
      for (const testCase of invalidVerifyEmailSearchParams) {
        test(`should redirect to Home and show "Invalid verification link" with ${testCase.name}`, async ({
          page,
        }) => {
          await loginPage.navigate();
          await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
          await homePage.expectToBeOnPage();

          const searchParams = new URLSearchParams();
          for (const [key, value] of Object.entries(testCase.params)) {
            searchParams.set(key, String(value));
          }
          const url = `/verify-email?${searchParams.toString()}`;

          await page.goto(url);
          await homePage.expectToBeOnPage();
          await expect(verifyEmailPage.invalidLinkToastTitle).toBeVisible();
        });
      }
    });

    test.describe('Authenticated + Unverified', () => {
      for (const testCase of invalidVerifyEmailSearchParams) {
        test(`should not navigate away from /verify-email for ${testCase.name}`, async ({page}) => {
          await loginPage.navigate();
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
      for (const testCase of invalidVerifyEmailSearchParams) {
        test(`should redirect to Login and show "Invalid verification link" with ${testCase.name}`, async ({
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
