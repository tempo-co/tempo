import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';

test.describe('auth errors during a session', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test.beforeEach(async ({page}) => {
    await page.goto('/bank-transactions');
    await expect(page.getByText('Coffee shop')).toBeVisible();
  });

  test('redirects to login when the session expires mid-session', async ({
    page,
    context,
    loginPage,
  }) => {
    await context.clearCookies();
    await page.getByTestId('bank-transactions-search').fill('coffee');

    await expect(page.getByText('Your session has expired')).toBeVisible();
    await loginPage.expectToBeOnPage();
    await expect(loginPage.emailInput).toBeVisible();
  });

  test('redirects to email verification when the API requires a verified email', async ({
    page,
    verifyEmailPage,
  }) => {
    await page.route('**/bank-transactions?*', async (route) => {
      if (!['fetch', 'xhr'].includes(route.request().resourceType())) {
        await route.continue();
        return;
      }
      await fulfillJson(route, {message: 'Email not verified.', statusCode: 403}, 403);
    });
    await page.getByTestId('bank-transactions-search').fill('coffee');

    await expect(page.getByText('Email not verified', {exact: true})).toBeVisible();
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(verifyEmailPage.pageTitle).toBeVisible();
  });
});
