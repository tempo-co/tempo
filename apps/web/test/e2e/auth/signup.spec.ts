import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {EmailUtils} from 'test/utils/email-utils';
import {HomePage} from 'test/pages/home.page';

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
    await signupPage.navigate();
  });

  test('should create account, verify email via CODE, and land on home page', async () => {
    const email = await signupPage.fillAndSubmitForm();

    await verifyEmailPage.expectToBeOnPage();
    const code = await EmailUtils.extractCodeFromEmail(email);
    await verifyEmailPage.inputCodeAndSubmit(code);

    await homePage.expectToBeOnPage();
    await homePage.expectWelcomeMessage();
    await homePage.expectUserLoggedIn();
  });

  test('should create account, verify email via LINK, and land on home page', async () => {
    const email = await signupPage.fillAndSubmitForm();

    await verifyEmailPage.expectToBeOnPage();
    const link = await EmailUtils.extractLinkFromEmail(email);
    await verifyEmailPage.page.goto(link);

    await homePage.expectToBeOnPage();
    await homePage.expectWelcomeMessage();
    await homePage.expectUserLoggedIn();
  });

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
    await signupPage.emailInput.focus();
    await signupPage.submitButton.click();
    await expect(signupPage.requiredError.first()).toBeVisible();
  });

  test('should show error for empty name', async () => {
    await signupPage.nameInput.focus();
    await signupPage.submitButton.click();
    await expect(signupPage.requiredError.first()).toBeVisible();
  });

  test('should show error for empty password', async () => {
    await signupPage.passwordInput.focus();
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
