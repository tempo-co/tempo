import {
  UNVERIFIED_ACCOUNT_EMAIL,
  UNVERIFIED_ACCOUNT_PASSWORD,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
} from 'test/constants/seed.constants';

import {createVerifiedAccount, expect, test} from '../../fixtures';
import {mockJson} from '../../utils/api-mocks';

test.describe('Login', () => {
  test.describe('Opening Tempo signed out', () => {
    test.use({storageState: {cookies: [], origins: []}});

    test('checks the session before loading page code, then shows the login form', async ({
      page,
      baseURL,
      loginPage,
    }) => {
      await mockJson(page, '**/accounts/me', {message: 'Unauthorized'}, 401);
      // Scripts named in index.html load with the app; any other script is code loaded for a page.
      const html = await (await page.request.get('/')).text();
      const appScripts = new Set(
        [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map(
          ([, src]) => new URL(src, baseURL).pathname,
        ),
      );
      const events: string[] = [];
      page.on('request', (request) => {
        const {pathname} = new URL(request.url());
        if (pathname.endsWith('/accounts/me')) events.push('session check');
        else if (request.resourceType() === 'script' && !appScripts.has(pathname))
          events.push('page code');
      });

      await page.goto('/');

      await loginPage.expectToBeOnPage();
      await expect(loginPage.emailInput).toBeVisible();
      expect(events[0]).toBe('session check');
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

      await loginPage.navigate();

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
