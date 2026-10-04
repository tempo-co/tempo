import {faker} from '@faker-js/faker';
import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {UNVERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_EMAIL} from 'test/constants/seed.constants';
import {EmailUtils} from 'test/utils/email-utils';

import {expect, test} from '../../fixtures';

test.describe('Account Settings: Email change', () => {
  test('should change email through the emailed link', async ({
    page,
    freshAccount,
    accountSettingsPage,
    homePage,
    verifyEmailChangePage,
  }) => {
    const newEmail = faker.internet.email().toLowerCase();

    await accountSettingsPage.requestEmailChange(newEmail);
    await expect(accountSettingsPage.emailChangeSentTo).toHaveText(newEmail);
    await accountSettingsPage.emailChangeDoneButton.click();
    await expect(accountSettingsPage.emailChangeSentTo).toBeHidden();
    await expect(homePage.sidebarAccountEmail).toHaveText(freshAccount.email);

    const message = await EmailUtils.findEmailByRecipient(newEmail);
    await page.goto(EmailUtils.extractEmailChangeLink(message?.Text));

    await accountSettingsPage.expectToBeOnPage();
    await expect(verifyEmailChangePage.emailChangeSuccessToast).toBeVisible();
    await expect(homePage.sidebarAccountEmail).toHaveText(newEmail);
  });

  test('should finish the change after logging in from a logged-out link', async ({
    page,
    freshAccount,
    accountSettingsPage,
    homePage,
    loginPage,
    verifyEmailChangePage,
  }) => {
    const newEmail = faker.internet.email().toLowerCase();
    await accountSettingsPage.requestEmailChange(newEmail);
    await expect(accountSettingsPage.emailChangeSentTo).toHaveText(newEmail);

    const message = await EmailUtils.findEmailByRecipient(newEmail);
    await page.context().clearCookies();
    await page.goto(EmailUtils.extractEmailChangeLink(message?.Text));

    await expect(verifyEmailChangePage.loginRequiredToast).toBeVisible();
    await page.waitForURL((url) => url.pathname === '/login');
    await loginPage.emailInput.fill(freshAccount.email);
    await loginPage.passwordInput.fill(freshAccount.password);
    await loginPage.submitButton.click();

    await accountSettingsPage.expectToBeOnPage();
    await expect(verifyEmailChangePage.emailChangeSuccessToast).toBeVisible();
    await expect(homePage.sidebarAccountEmail).toHaveText(newEmail);
  });

  test('should go back to the form with "Use a different email"', async ({
    freshAccount,
    accountSettingsPage,
  }) => {
    const newEmail = faker.internet.email().toLowerCase();
    await accountSettingsPage.navigate();
    await accountSettingsPage.changeEmailButton.click();
    await expect(accountSettingsPage.page.getByRole('dialog')).toContainText(freshAccount.email);
    await accountSettingsPage.newEmailInput.fill(newEmail);
    await accountSettingsPage.sendVerificationLinkButton.click();
    await expect(accountSettingsPage.emailChangeSentTo).toHaveText(newEmail);

    await accountSettingsPage.useDifferentEmailButton.click();

    await expect(accountSettingsPage.newEmailInput).toBeVisible();
    await expect(accountSettingsPage.newEmailInput).toBeEmpty();
  });

  test('should keep the dialog open while sending, then reset it after closing', async ({
    page,
    freshAccount,
    accountSettingsPage,
  }) => {
    let finish!: () => void;
    let intercepted!: () => void;
    const sending = new Promise<void>((resolve) => {
      intercepted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route('**/auth/change-email/request', async (route) => {
      intercepted();
      await release;
      await route.continue();
    });

    await accountSettingsPage.navigate();
    await accountSettingsPage.changeEmailButton.click();
    await accountSettingsPage.newEmailInput.fill(`pending-${freshAccount.email}`);
    await accountSettingsPage.sendVerificationLinkButton.click();
    await sending;
    try {
      await expect(accountSettingsPage.sendVerificationLinkButton).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', {name: 'Close', exact: true}).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    } finally {
      finish();
    }
    await expect(accountSettingsPage.emailChangeSentTo).toBeVisible();
    await accountSettingsPage.emailChangeDoneButton.click();
    await accountSettingsPage.changeEmailButton.click();
    await expect(accountSettingsPage.newEmailInput).toBeEmpty();
    await expect(accountSettingsPage.emailChangeSentTo).toBeHidden();
  });

  test.describe('Validation errors', () => {
    test.use({storageState: VERIFIED_USER_AUTH_FILE});

    for (const {name, email, error} of [
      {
        name: 'email already in use',
        email: UNVERIFIED_ACCOUNT_EMAIL,
        error: 'emailAlreadyInUseError',
      },
      {
        name: 'email already in use with different casing',
        email: UNVERIFIED_ACCOUNT_EMAIL.toUpperCase(),
        error: 'emailAlreadyInUseError',
      },
      {
        name: 'new email is the same as the current one',
        email: VERIFIED_ACCOUNT_EMAIL,
        error: 'sameEmailError',
      },
      {
        name: 'new email is the current one with different casing',
        email: VERIFIED_ACCOUNT_EMAIL.toUpperCase(),
        error: 'sameEmailError',
      },
      {name: 'invalid email format', email: 'not-an-email', error: 'invalidEmailError'},
    ] as const) {
      test(`should show an inline error when ${name}`, async ({accountSettingsPage}) => {
        await accountSettingsPage.requestEmailChange(email);

        await expect(accountSettingsPage[error]).toBeVisible();
        await expect(accountSettingsPage.newEmailInput).toHaveValue(email);
        await expect(accountSettingsPage.emailChangeSentTo).toBeHidden();
      });
    }
  });
});
