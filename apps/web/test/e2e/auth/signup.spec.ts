import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {HomePage} from 'test/pages/home.page';
import {EmailUtils} from 'test/utils/email-utils';

import {SignupPage} from '../../pages/signup.page';
import {VerifyEmailPage} from '../../pages/verify-email.page';

test.describe.serial('Signup', () => {
  let signupPage: SignupPage;
  let verifyEmailPage: VerifyEmailPage;
  let homePage: HomePage;

  test.beforeEach(async ({page}) => {
    signupPage = new SignupPage(page);
    verifyEmailPage = new VerifyEmailPage(page);
    homePage = new HomePage(page);

    await EmailUtils.clearEmails();
    await signupPage.navigate();
  });

  test.describe('Successful signup flow', () => {
    test('should create account, verify email via CODE, and land on home page', async () => {
      const email = await signupPage.fillAndSubmitForm();

      await verifyEmailPage.expectToBeOnPage();
      const message = await EmailUtils.findEmailByRecipient(email);
      const code = EmailUtils.extractCode(message?.Text);
      await verifyEmailPage.inputCodeAndSubmit(code);

      await homePage.expectToBeOnPage();
      await homePage.expectWelcomeMessage();
      await homePage.expectUserLoggedIn();
    });

    test('should create account, verify email via LINK, and land on home page', async ({page}) => {
      const email = await signupPage.fillAndSubmitForm();

      await verifyEmailPage.expectToBeOnPage();
      const message = await EmailUtils.findEmailByRecipient(email);
      const verificationLink = EmailUtils.extractOnboardingVerifyEmailLink(message?.Text);
      await page.goto(verificationLink);

      await homePage.expectToBeOnPage();
      await homePage.expectWelcomeMessage();
      await homePage.expectUserLoggedIn();

      // Try reusing the link
      await page.goto(verificationLink);
      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();
      await expect(homePage.alreadyVerifiedToastTitle).toBeVisible();
    });

    test('should redirect to login on link click', async ({page}) => {
      await signupPage.loginLink.click();
      expect(page.url()).toContain('/login');
    });
  });

  test.describe('Signup (Authenticated)', () => {
    test.use({storageState: VERIFIED_USER_AUTH_FILE});

    test('should redirect to home if a logged in user navigates to /signup', async ({page}) => {
      await signupPage.navigate();
      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();

      expect(page.url()).not.toContain('/signup');
    });
  });

  test.describe('Validation errors', () => {
    test('should show error for email already in use', async () => {
      const name = faker.person.fullName();
      const password = faker.internet.password();

      await signupPage.emailInput.fill('verified@test.com');
      await signupPage.nameInput.fill(name);
      await signupPage.passwordInput.fill(password);
      await signupPage.submitButton.click();

      await expect(signupPage.emailAlreadyInUseError).toBeVisible();
    });

    test('should show error for empty email', async () => {
      await signupPage.submitButton.click();
      await expect(signupPage.requiredError.first()).toBeVisible();
    });

    test('should show error for empty name', async () => {
      await signupPage.submitButton.click();
      await expect(signupPage.requiredError.first()).toBeVisible();
    });

    test('should show error for empty password', async () => {
      await signupPage.submitButton.click();
      await expect(signupPage.requiredError.first()).toBeVisible();
    });

    test('should show error for password too short', async () => {
      await signupPage.passwordInput.fill('123');
      await signupPage.submitButton.click();
      await expect(signupPage.passwordTooShortError).toBeVisible();
    });

    test('should show error for password too long', async () => {
      const longPassword = faker.string.alphanumeric(256);
      await signupPage.passwordInput.fill(longPassword);
      await signupPage.submitButton.click();
      await expect(signupPage.passwordTooLongError).toBeVisible();
    });

    test('should show error for invalid email format', async () => {
      await signupPage.emailInput.fill('invalid-email');
      await signupPage.submitButton.click();
      await expect(signupPage.emailInvalidError).toBeVisible();
    });

    test('should show error for name too long', async () => {
      const longName = faker.string.alphanumeric(256);
      await signupPage.nameInput.fill(longName);
      await signupPage.submitButton.click();
      await expect(signupPage.nameTooLongError).toBeVisible();
    });
  });
});
