import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {AccountSettingsPage} from 'test/pages/account-settings.page';
import {HomePage} from 'test/pages/home.page';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test.describe('Account Settings: Name change', () => {
  let homePage: HomePage;
  let accountSettingsPage: AccountSettingsPage;

  test.beforeEach(async ({page}) => {
    homePage = new HomePage(page);
    accountSettingsPage = new AccountSettingsPage(page);

    await accountSettingsPage.navigate();
  });

  test('should change name successfully and persist after reload', async ({page}) => {
    const newName = faker.person.fullName();
    await accountSettingsPage.changeName(newName);

    await expect(page.getByText('Name saved.')).toBeVisible();
    await expect(homePage.sidebarAccountName).toHaveText(newName);

    await page.reload();
    await expect(homePage.sidebarAccountName).toHaveText(newName);
  });

  test('should show error for empty name', async ({page}) => {
    await accountSettingsPage.changeName('');
    await expect(page.getByText('Please enter your name.')).toBeVisible();
  });

  test('should show error for name longer than 255 characters', async ({page}) => {
    const longName = faker.string.alphanumeric(256);
    await accountSettingsPage.nameInput.fill(longName);

    await expect(page.getByText('Name must be less than 256 characters.')).toBeVisible();
  });
});
