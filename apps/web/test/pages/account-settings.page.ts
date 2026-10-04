import {Locator, Page} from '@playwright/test';

export class AccountSettingsPage {
  readonly page: Page;
  readonly changeEmailButton: Locator;
  readonly newEmailInput: Locator;
  readonly sendVerificationLinkButton: Locator;
  readonly emailChangeSentTo: Locator;
  readonly useDifferentEmailButton: Locator;
  readonly emailChangeDoneButton: Locator;
  readonly nameInput: Locator;
  readonly sameEmailError: Locator;
  readonly emailAlreadyInUseError: Locator;
  readonly invalidEmailError: Locator;
  readonly deleteAccountButton: Locator;
  readonly deletePasswordInput: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteInvalidPasswordError: Locator;
  readonly deleteMissingPasswordError: Locator;

  constructor(page: Page) {
    this.page = page;
    this.changeEmailButton = page.getByTestId('change-email-button');
    this.newEmailInput = page.getByTestId('new-email-input');
    this.sendVerificationLinkButton = page.getByTestId('send-verification-link-button');
    this.emailChangeSentTo = page.getByTestId('email-change-sent-to');
    this.useDifferentEmailButton = page.getByTestId('use-different-email-button');
    this.emailChangeDoneButton = page.getByTestId('email-change-done-button');
    this.nameInput = page.getByTestId('name-input');
    this.sameEmailError = page.getByText('This is already your email.');
    this.emailAlreadyInUseError = page.getByText('Another account already uses this email.');
    this.invalidEmailError = page.getByText('Please enter a valid email address.');
    this.deleteAccountButton = page.getByTestId('delete-account-button');
    this.deletePasswordInput = page.getByTestId('password-input');
    this.deleteConfirmButton = page.getByTestId('delete-account-confirm');
    this.deleteInvalidPasswordError = page.getByText('Invalid password.');
    this.deleteMissingPasswordError = page.getByText('Please enter your password.');
  }

  async navigate() {
    await this.page.goto('/settings/account');
  }

  async changeName(newName: string) {
    await this.nameInput.fill(newName);
    await this.page.keyboard.press('Tab'); // triggers a blur event
  }

  async requestEmailChange(newEmail: string) {
    await this.navigate();
    await this.changeEmailButton.click();
    await this.newEmailInput.fill(newEmail);
    await this.sendVerificationLinkButton.click();
  }

  async expectToBeOnPage() {
    await this.page.waitForURL('/settings/account');
  }
}
