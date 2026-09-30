import {expect, test} from '@playwright/test';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {LoginPage} from '../../pages/login.page';
import {VerifyEmailPage} from '../../pages/verify-email.page';

test.describe('auth errors during a session', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test.beforeEach(async ({page}) => {
    await page.goto('/bank-transactions');
    await expect(page.getByText('Coffee shop')).toBeVisible();
  });

  test('redirects to login when the session expires mid-session', async ({page, context}) => {
    const loginPage = new LoginPage(page);

    await context.clearCookies();
    await page.getByTestId('bank-transactions-search').fill('coffee');

    await expect(page.getByText('Your session has expired')).toBeVisible();
    await loginPage.expectToBeOnPage();
    await expect(loginPage.emailInput).toBeVisible();
  });

  test('redirects to email verification when the API requires a verified email', async ({page}) => {
    const verifyEmailPage = new VerifyEmailPage(page);

    await page.route('**/bank-transactions?*', async (route) => {
      if (!['fetch', 'xhr'].includes(route.request().resourceType())) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({message: 'Email not verified.', statusCode: 403}),
      });
    });
    await page.getByTestId('bank-transactions-search').fill('coffee');

    await expect(page.getByText('Email not verified', {exact: true})).toBeVisible();
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(verifyEmailPage.pageTitle).toBeVisible();
  });
});
