import type {BankConnection} from '../../../src/features/banking/types/bank-connection';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections} from '../../utils/api-mocks';

test.describe('auth errors during a session', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test.beforeEach(async ({page}) => {
    // Load the fixture before navigation so late banking responses cannot restore cleared cookies.
    const response = await page.request.get(`${API_URL}/bank-connections`);
    expect(response.status()).toBe(200);
    const connections = (await response.json()) as BankConnection[];
    await mockBankConnections(page, connections.map((connection) => ({...connection, status: 'EXPIRED'})));
    const connectionsResponse = page.waitForResponse(`${API_URL}/bank-connections`);
    await page.goto('/bank-transactions');
    await expect(page.getByText('Coffee shop')).toBeVisible();
    // Finish the initial connection load before expiring the Tempo session.
    await (await connectionsResponse).finished();
  });

  test('redirects to login when the session expires mid-session', async ({
    page,
    context,
    loginPage,
  }) => {
    await context.clearCookies();
    const searchResponse = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${API_URL}/bank-transactions?`) &&
        new URL(response.url()).searchParams.get('filter[search]') === 'coffee',
    );
    await page.getByTestId('bank-transactions-search').fill('coffee');
    expect((await searchResponse).status()).toBe(401);

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
