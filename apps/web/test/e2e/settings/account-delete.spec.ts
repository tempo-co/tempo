import {expect, test} from '../../fixtures';

test.describe('Account Settings: Delete account', () => {
  test('should delete the account after password confirmation', async ({
    page,
    freshAccount: {email, password},
    accountSettingsPage,
    homePage,
    loginPage,
  }) => {
    await page.setViewportSize({width: 393, height: 852});
    await accountSettingsPage.navigate();

    await accountSettingsPage.deleteAccountButton.click();
    const deleteCancelButton = page.getByRole('button', {name: 'Cancel'});
    await expect(deleteCancelButton).toBeVisible();
    expect(
      await deleteCancelButton.evaluate(
        (element) => getComputedStyle(element.parentElement!).paddingBottom,
      ),
    ).toBe('16px');

    // An empty password is rejected before any request is made.
    let deleteRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'DELETE' && request.url().endsWith('/accounts/me')) deleteRequests++;
    });
    await accountSettingsPage.deleteConfirmButton.click();
    await expect(accountSettingsPage.deleteMissingPasswordError).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(deleteRequests).toBe(0);

    // Cancelling clears the typed password.
    await accountSettingsPage.deletePasswordInput.fill('typed-then-cancelled');
    await deleteCancelButton.click();
    await accountSettingsPage.deleteAccountButton.click();
    await expect(accountSettingsPage.deletePasswordInput).toHaveValue('');
    await expect(accountSettingsPage.deleteMissingPasswordError).not.toBeVisible();

    // Wrong password is rejected and the dialog stays open.
    await accountSettingsPage.deletePasswordInput.fill('wrong-password');
    await accountSettingsPage.deleteConfirmButton.click();
    await expect(accountSettingsPage.deleteInvalidPasswordError).toBeVisible();

    // Correct password deletes the account, signs the user out, and routes to '/'.
    await accountSettingsPage.deletePasswordInput.fill(password);
    await accountSettingsPage.deleteConfirmButton.click();

    await expect(page.getByText('Account deleted.')).toBeVisible();
    await homePage.expectToBeOnPage();

    // The account is really gone: re-login fails.
    await loginPage.navigate();
    await loginPage.login(email, password);
    await expect(loginPage.invalidCredentialsError).toBeVisible();
  });
});
