import {expect, test} from '@playwright/test';
import {
  PW_CHANGE_ACCOUNT_EMAIL,
  PW_CHANGE_ACCOUNT_PASSWORD,
  UNVERIFIED_ACCOUNT_EMAIL,
  UNVERIFIED_ACCOUNT_PASSWORD,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
} from 'test/constants/seed.constants';

import {HomePage} from '../../pages/home.page';
import {LoginPage} from '../../pages/login.page';
import {VerifyEmailPage} from '../../pages/verify-email.page';

test.describe('Login', () => {
  let loginPage: LoginPage;
  let homePage: HomePage;
  let verifyEmailPage: VerifyEmailPage;

  test.beforeEach(({page}) => {
    loginPage = new LoginPage(page);
    homePage = new HomePage(page);
    verifyEmailPage = new VerifyEmailPage(page);
  });

  test.describe('Successful login flow', () => {
    test('should login successfully with verified account and redirect to home page', async () => {
      await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();
    });

    test('should isolate transaction cache when switching accounts', async ({page}) => {
      const transactionUrl =
        '/bank-transactions?transactionId=00000000-0000-4000-8000-000000000011';

      await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
      await homePage.expectToBeOnPage();
      await page.goto(transactionUrl);
      const inspector = page.getByTestId('bank-transaction-inspector');
      await expect(inspector.getByRole('heading', {name: 'Coffee shop'})).toBeVisible();
      await inspector.getByRole('button', {name: 'Close transaction details'}).click();
      await expect(inspector).toBeHidden();

      await homePage.logOut();
      await loginPage.expectToBeOnPage();
      await loginPage.login(PW_CHANGE_ACCOUNT_EMAIL, PW_CHANGE_ACCOUNT_PASSWORD);
      await homePage.expectToBeOnPage();

      await page.goto(transactionUrl);
      await expect(page.getByRole('heading', {name: 'Transaction not found'})).toBeVisible();
    });

    test('should redirect to home page if a logged in user navigates to /login', async ({page}) => {
      await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
      await homePage.expectToBeOnPage();

      await loginPage.navigate();

      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();
      expect(page.url()).not.toContain('/login');
    });

    test('should redirect to verify email page for unverified account', async () => {
      await loginPage.login(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
      await verifyEmailPage.expectToBeOnPage();
    });

    test('should navigate to signup on link click', async ({page}) => {
      await loginPage.navigate();
      await loginPage.signupLink.click();
      expect(page.url()).toContain('/signup');
    });

    test('should navigate to reset password page when link is clicked', async ({page}) => {
      await loginPage.navigate();
      await loginPage.forgotPasswordLink.click();
      await expect(page).toHaveURL('/reset-password');
    });
  });

  test.describe('Validation errors', () => {
    test('should show error for non-existent email', async () => {
      await loginPage.login('nonexistent@test.com', 'password');
      await expect(loginPage.invalidCredentialsError).toBeVisible();
    });

    test('should show error for incorrect password', async () => {
      await loginPage.login(VERIFIED_ACCOUNT_EMAIL, 'wrongpassword');
      await expect(loginPage.invalidCredentialsError).toBeVisible();
    });

    test('should show error for empty email', async () => {
      await loginPage.login('', VERIFIED_ACCOUNT_PASSWORD);
      await expect(loginPage.requiredError).toBeVisible();
    });

    test('should show error for empty password', async () => {
      await loginPage.login(VERIFIED_ACCOUNT_EMAIL, '');
      await expect(loginPage.requiredError).toBeVisible();
    });
  });
});
