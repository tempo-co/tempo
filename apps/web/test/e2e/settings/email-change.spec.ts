import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {EMAIL_CHANGE_USER_AUTH_FILE, VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {UNVERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_EMAIL} from 'test/constants/seed.constants';
import {AccountSettingsPage} from 'test/pages/account-settings.page';
import {HomePage} from 'test/pages/home.page';
import {VerifyEmailChangePage} from 'test/pages/verify-email-change.page';
import {EmailUtils} from 'test/utils/email-utils';

test.use({storageState: EMAIL_CHANGE_USER_AUTH_FILE});

test.describe('Account Settings: Email change', () => {
  let homePage: HomePage;
  let accountSettingsPage: AccountSettingsPage;
  let verifyEmailChangePage: VerifyEmailChangePage;

  test.beforeEach(({page}) => {
    homePage = new HomePage(page);
    accountSettingsPage = new AccountSettingsPage(page);
    verifyEmailChangePage = new VerifyEmailChangePage(page);
  });

  test('should change email successfully', async ({page}) => {
    const newEmail = faker.internet.email();

    await accountSettingsPage.checkEmailAvailability(newEmail);
    await accountSettingsPage.sendVerificationLinkButton.click();

    const message = await EmailUtils.findEmailByRecipient(newEmail);
    const verificationLink = EmailUtils.extractEmailChangeLink(message?.Text);
    await page.goto(verificationLink);

    await homePage.expectToBeOnPage();
    await expect(verifyEmailChangePage.emailChangeSuccessToast).toBeVisible();
    await expect(homePage.sidebarAccountEmail).toHaveText(newEmail);
  });

  test('should allow navigating back to step 1 from step 2', async () => {
    const newEmail = faker.internet.email();
    await accountSettingsPage.checkEmailAvailability(newEmail);

    await expect(accountSettingsPage.getStep2DescriptionLocator(newEmail)).toBeVisible();
    await accountSettingsPage.backButton.click();

    await expect(accountSettingsPage.emailChangeStep1Description).toBeVisible();
    await expect(accountSettingsPage.newEmailInput).toBeEmpty();
  });

  test.describe('Validation errors', () => {
    test.use({storageState: VERIFIED_USER_AUTH_FILE});

    test('should show error for email already in use', async () => {
      await accountSettingsPage.checkEmailAvailability(UNVERIFIED_ACCOUNT_EMAIL);
      await expect(accountSettingsPage.emailAlreadyInUseError).toBeVisible();
    });

    test('should show error when new email is the same as the current one', async () => {
      await accountSettingsPage.checkEmailAvailability(VERIFIED_ACCOUNT_EMAIL);
      await expect(accountSettingsPage.sameEmailError).toBeVisible();
    });

    test('should show error for invalid email format', async () => {
      await accountSettingsPage.checkEmailAvailability('not-an-email');
      await expect(accountSettingsPage.invalidEmailError).toBeVisible();
    });
  });
});
