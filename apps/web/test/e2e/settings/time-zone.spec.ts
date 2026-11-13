import {expect, test} from '../../fixtures';
import {EmailUtils} from '../../utils/email-utils';

test.describe('Account Settings: Time zone', () => {
  test.describe('a new account', () => {
    test.use({timezoneId: 'Europe/Lisbon'});

    test("starts in the browser's time zone", async ({
      page,
      signupPage,
      verifyEmailPage,
      homePage,
      accountSettingsPage,
    }) => {
      await EmailUtils.clearEmails();
      await signupPage.navigate();
      const email = await signupPage.fillAndSubmitForm();
      await verifyEmailPage.expectToBeOnPage();
      await verifyEmailPage.inputCodeAndSubmit(await EmailUtils.getVerificationCode(email));
      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();

      await page.getByTestId('account-menu-trigger').click();
      await page.getByRole('menuitem', {name: 'Settings'}).click();
      await expect(accountSettingsPage.timeZone).toHaveText('Europe/Lisbon');
    });
  });

  test.describe('changing it', () => {
    // A fresh account per test, so changing the zone never touches the seeded accounts other specs use.
    test.beforeEach(async ({freshAccount, accountSettingsPage, homePage}) => {
      await accountSettingsPage.navigate();
      await expect(homePage.accountEmail).toHaveText(freshAccount.email);
    });

    test('searches the list, saves the chosen zone and keeps it after reload', async ({
      page,
      accountSettingsPage,
    }) => {
      // An account created without a browser zone has the default one, marked in the list.
      await expect(accountSettingsPage.timeZone).toHaveText('Europe/Amsterdam');
      await accountSettingsPage.editTimeZoneButton.click();
      const dialog = page.getByRole('dialog');
      // The list opens on the current zone, which is marked.
      const current = dialog.getByRole('button', {name: 'Europe/Amsterdam'});
      await expect(current).toHaveAttribute('aria-current', 'true');
      await expect(current).toBeFocused();
      await expect(current).toBeInViewport();
      await accountSettingsPage.timeZoneSearch.fill('no such place');
      await expect(dialog.getByText('No time zone called “no such place”')).toBeVisible();

      await accountSettingsPage.timeZoneSearch.fill('new york');
      await dialog.getByRole('button', {name: 'America/New York'}).click();

      await expect(dialog).toBeHidden();
      await expect(accountSettingsPage.timeZone).toHaveText('America/New York');
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

      await page.reload();
      await expect(accountSettingsPage.timeZone).toHaveText('America/New York');
    });

    test.describe('on a phone', () => {
      test.use({viewport: {width: 390, height: 844}, hasTouch: true});

      test('opens the sheet on the current zone without focusing the search', async ({
        page,
        accountSettingsPage,
      }) => {
        await accountSettingsPage.editTimeZoneButton.click();

        const current = page.getByRole('dialog').getByRole('button', {name: 'Europe/Amsterdam'});
        await expect(current).toBeFocused();
        await expect(current).toBeInViewport();
        await expect(accountSettingsPage.timeZoneSearch).not.toBeFocused();
      });
    });

    test('reports a failed save and keeps the list open', async ({page, accountSettingsPage}) => {
      await page.route('**/accounts/me', (route) =>
        route.request().method() === 'PATCH'
          ? route.fulfill({status: 500, json: {message: 'Internal server error'}})
          : route.fallback(),
      );

      await accountSettingsPage.chooseTimeZone('helsinki', 'Europe/Helsinki');

      await expect(
        page.getByText('Your time zone could not be saved. Please try again.'),
      ).toBeVisible();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(accountSettingsPage.timeZone).toHaveText('Europe/Amsterdam');
    });
  });
});
