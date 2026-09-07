import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {HomePage} from 'test/pages/home.page';
import {EmailUtils} from 'test/utils/email-utils';

import {AccountSettingsPage} from '../../pages/account-settings.page';
import {LoginPage} from '../../pages/login.page';
import {SignupPage} from '../../pages/signup.page';
import {VerifyEmailPage} from '../../pages/verify-email.page';

test.describe.serial('Account Settings: Delete account', () => {
  const password = faker.internet.password({length: 12});
  let email: string;
  let signupPage: SignupPage;
  let verifyEmailPage: VerifyEmailPage;
  let homePage: HomePage;
  let accountSettingsPage: AccountSettingsPage;
  let loginPage: LoginPage;

  test.beforeEach(({page}) => {
    signupPage = new SignupPage(page);
    verifyEmailPage = new VerifyEmailPage(page);
    homePage = new HomePage(page);
    accountSettingsPage = new AccountSettingsPage(page);
    loginPage = new LoginPage(page);
  });

  test('should delete the account after email and password confirmation', async ({page}) => {
    await EmailUtils.clearEmails();
    email = faker.internet.email().toLowerCase();
    const name = faker.person.fullName();

    await signupPage.navigate();
    await signupPage.emailInput.fill(email);
    await signupPage.nameInput.fill(name);
    await signupPage.passwordInput.fill(password);
    await signupPage.submitButton.click();

    await verifyEmailPage.expectToBeOnPage();
    const message = await EmailUtils.findEmailByRecipient(email);
    const code = EmailUtils.extractCode(message?.Text);
    await verifyEmailPage.inputCodeAndSubmit(code);

    await homePage.expectToBeOnPage();
    await homePage.expectUserLoggedIn();

    await accountSettingsPage.navigate();

    // The destructive action stays disabled until the email matches exactly.
    await accountSettingsPage.deleteAccountButton.click();
    await expect(accountSettingsPage.deleteConfirmButton).toBeDisabled();
    await accountSettingsPage.deleteEmailInput.fill(email);
    await expect(accountSettingsPage.deleteConfirmButton).toBeDisabled();

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
