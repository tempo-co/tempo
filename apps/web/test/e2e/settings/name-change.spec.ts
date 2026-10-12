import {faker} from '@faker-js/faker';

import {expect, test} from '../../fixtures';

test.describe('Account Settings: Name change', () => {
  // A fresh account per test, so renaming never touches the seeded accounts other specs use.
  test.beforeEach(async ({freshAccount, accountSettingsPage, homePage}) => {
    await accountSettingsPage.navigate();
    await expect(homePage.accountEmail).toHaveText(freshAccount.email);
  });

  test('should change name successfully and persist after reload', async ({
    page,
    accountSettingsPage,
    homePage,
  }) => {
    const newName = faker.person.fullName();
    await accountSettingsPage.changeName(newName);

    await expect(page.getByText('Name saved.')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(homePage.accountName).toHaveText(newName);

    await page.reload();
    await expect(homePage.accountName).toHaveText(newName);
  });

  test('should show error for empty name', async ({page, accountSettingsPage}) => {
    await accountSettingsPage.changeName('');
    await expect(page.getByText('Please enter your name.')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('should show error for whitespace-only name', async ({page, accountSettingsPage}) => {
    await accountSettingsPage.changeName('   ');
    await expect(page.getByText('Please enter your name.')).toBeVisible();
    await expect(page.getByTestId('name-input')).toBeFocused();
  });

  test('should show error for name longer than 255 characters', async ({
    page,
    accountSettingsPage,
  }) => {
    const longName = faker.string.alphanumeric(256);
    await accountSettingsPage.changeName(longName);

    await expect(page.getByText('Name must be less than 256 characters.')).toBeVisible();
  });
});
