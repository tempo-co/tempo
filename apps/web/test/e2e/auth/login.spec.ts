import {
  UNVERIFIED_ACCOUNT_EMAIL,
  UNVERIFIED_ACCOUNT_PASSWORD,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
} from '../../constants/seed.constants';
import {createVerifiedAccount, expect, test} from '../../fixtures';
import {LoginPage} from '../../pages/login.page';
import {fulfillJson} from '../../utils/api-mocks';

test.describe('Login', () => {
  test.describe('Opening Tempo signed out', () => {
    // Every script must pass through page.route, not the offline shell.
    test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'block'});

    test('shows the login form while the requested page is still loading', async ({
      page,
      context,
      loginPage,
    }) => {
      await context.route('**/accounts/me', (route) =>
        fulfillJson(route, {message: 'Unauthorized'}, 401),
      );
      const loginScripts = new Set<string>();
      const loginTab = await context.newPage();
      loginTab.on('request', (request) => {
        if (request.resourceType() === 'script') loginScripts.add(request.url());
      });
      await loginTab.goto('/login');
      await expect(new LoginPage(loginTab).emailInput).toBeVisible();
      await loginTab.close();
      // Any other page's code is left unanswered, so it never arrives.
      await page.route('**/*.js', async (route) => {
        if (loginScripts.has(route.request().url())) await route.continue();
      });

      await page.goto('/');

      await loginPage.expectToBeOnPage();
      await expect(loginPage.emailInput).toBeVisible();
    });
  });

  test.describe('Successful login flow', () => {
    test('should login successfully with verified account and redirect to home page', async ({
      loginPage,
      homePage,
    }) => {
      await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();
    });

    test('should isolate transaction cache when switching accounts', async ({
      page,
      request,
      loginPage,
      homePage,
    }) => {
      const otherAccount = await createVerifiedAccount(request);
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
      await loginPage.login(otherAccount.email, otherAccount.password);
      await homePage.expectToBeOnPage();

      await page.goto(transactionUrl);
      await expect(page.getByRole('heading', {name: 'Transaction not found'})).toBeVisible();
    });

    test('should redirect to home page if a logged in user navigates to /login', async ({
      page,
      loginPage,
      homePage,
    }) => {
      await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
      await homePage.expectToBeOnPage();

      // The redirect home can come before the page's load event, which would interrupt goto.
      await page.goto('/login', {waitUntil: 'commit'});

      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();
      expect(page.url()).not.toContain('/login');
    });

    test('should redirect to verify email page for unverified account', async ({
      loginPage,
      verifyEmailPage,
    }) => {
      await loginPage.login(UNVERIFIED_ACCOUNT_EMAIL, UNVERIFIED_ACCOUNT_PASSWORD);
      await verifyEmailPage.expectToBeOnPage();
    });

    test('should navigate to signup on link click', async ({page, loginPage}) => {
      await loginPage.navigate();
      await loginPage.signupLink.click();
      expect(page.url()).toContain('/signup');
    });

    test('should navigate to reset password page when link is clicked', async ({
      page,
      loginPage,
    }) => {
      await loginPage.navigate();
      await loginPage.forgotPasswordLink.click();
      await expect(page).toHaveURL('/reset-password');
    });
  });

  test.describe('Validation errors', () => {
    for (const {name, email, password, error} of [
      {
        name: 'non-existent email',
        email: 'nonexistent@test.com',
        password: 'password',
        error: 'invalidCredentialsError',
      },
      {
        name: 'incorrect password',
        email: VERIFIED_ACCOUNT_EMAIL,
        password: 'wrongpassword',
        error: 'invalidCredentialsError',
      },
      {name: 'empty email', email: '', password: VERIFIED_ACCOUNT_PASSWORD, error: 'requiredError'},
      {name: 'empty password', email: VERIFIED_ACCOUNT_EMAIL, password: '', error: 'requiredError'},
    ] as const) {
      test(`should show error for ${name}`, async ({loginPage}) => {
        await loginPage.login(email, password);
        await expect(loginPage[error]).toBeVisible();
      });
    }
  });
});
