import {Locator, Page} from '@playwright/test';

export class AccountSettingsPage {
  readonly page: Page;
  readonly changeEmailButton: Locator;
  readonly newEmailInput: Locator;
  readonly emailChangePasswordInput: Locator;
  readonly emailChangeInvalidPasswordError: Locator;
  readonly emailChangeMissingPasswordError: Locator;
  readonly sendVerificationLinkButton: Locator;
  readonly emailChangeSentTo: Locator;
  readonly useDifferentEmailButton: Locator;
  readonly emailChangeDoneButton: Locator;
  readonly editNameButton: Locator;
  readonly nameInput: Locator;
  readonly saveNameButton: Locator;
  readonly sameEmailError: Locator;
  readonly emailAlreadyInUseError: Locator;
  readonly invalidEmailError: Locator;
  readonly deleteAccountButton: Locator;
  readonly deletePasswordInput: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteInvalidPasswordError: Locator;
  readonly deleteMissingPasswordError: Locator;
  readonly timeZone: Locator;
  readonly editTimeZoneButton: Locator;
  readonly timeZoneSearch: Locator;

  constructor(page: Page) {
    this.page = page;
    this.changeEmailButton = page.getByTestId('change-email-button');
    this.newEmailInput = page.getByTestId('new-email-input');
    this.emailChangePasswordInput = page.getByLabel('Current password');
    this.emailChangeInvalidPasswordError = page.getByText('Invalid password.');
    this.emailChangeMissingPasswordError = page.getByText('Please enter your current password.');
    this.sendVerificationLinkButton = page.getByTestId('send-verification-link-button');
    this.emailChangeSentTo = page.getByTestId('email-change-sent-to');
    this.useDifferentEmailButton = page.getByTestId('use-different-email-button');
    this.emailChangeDoneButton = page.getByTestId('email-change-done-button');
    this.editNameButton = page.getByTestId('edit-name-button');
    this.nameInput = page.getByTestId('name-input');
    this.saveNameButton = page.getByTestId('save-name-button');
    this.sameEmailError = page.getByText('This is already your email.');
    this.emailAlreadyInUseError = page.getByText('Another account already uses this email.');
    this.invalidEmailError = page.getByText('Please enter a valid email address.');
    this.deleteAccountButton = page.getByTestId('delete-account-button');
    this.deletePasswordInput = page.getByTestId('password-input');
    this.deleteConfirmButton = page.getByTestId('delete-account-confirm');
    this.deleteInvalidPasswordError = page.getByText('Invalid password.');
    this.deleteMissingPasswordError = page.getByText('Please enter your password.');
    this.timeZone = page.getByTestId('account-time-zone');
    this.editTimeZoneButton = page.getByTestId('edit-time-zone-button');
    this.timeZoneSearch = page.getByTestId('time-zone-search');
  }

  async navigate() {
    await this.page.goto('/settings/account');
  }

  async changeName(newName: string) {
    await this.editNameButton.click();
    await this.nameInput.fill(newName);
    await this.saveNameButton.click();
  }

  /** Opens the time zone list, searches it and picks the one option whose name is `label`. */
  async chooseTimeZone(search: string, label: string) {
    await this.editTimeZoneButton.click();
    await this.timeZoneSearch.fill(search);
    await this.page.getByRole('dialog').getByRole('button', {name: label}).click();
  }

  async requestEmailChange(newEmail: string, currentPassword: string) {
    await this.navigate();
    await this.changeEmailButton.click();
    await this.newEmailInput.fill(newEmail);
    await this.emailChangePasswordInput.fill(currentPassword);
    await this.sendVerificationLinkButton.click();
  }

  async expectToBeOnPage() {
    await this.page.waitForURL('/settings/account');
  }
}
