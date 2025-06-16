import {Locator, Page} from '@playwright/test';

export class AccountSettingsPage {
  readonly page: Page;
  readonly changeEmailButton: Locator;
  readonly newEmailInput: Locator;
  readonly checkEmailButton: Locator;
  readonly sendVerificationLinkButton: Locator;
  readonly backButton: Locator;
  readonly nameInput: Locator;
  readonly sameEmailError: Locator;
  readonly emailAlreadyInUseError: Locator;
  readonly invalidEmailError: Locator;
  readonly emailChangeStep1Description: Locator;

  constructor(page: Page) {
    this.page = page;
    this.changeEmailButton = page.getByTestId('change-email-button');
    this.newEmailInput = page.getByTestId('new-email-input');
    this.checkEmailButton = page.getByTestId('check-email-button');
    this.sendVerificationLinkButton = page.getByTestId('send-verification-link-button');
    this.backButton = page.getByTestId('back-button');
    this.nameInput = page.getByTestId('name-input');
    this.sameEmailError = page.getByText('Please enter a different email from your current one.');
    this.emailAlreadyInUseError = page.getByText('This email is already in use.');
    this.invalidEmailError = page.getByText('Please enter a valid email address.');
    this.emailChangeStep1Description = page.getByText(
      "To change your account's email, we will send a verification link to your new address.",
    );
  }

  getStep2DescriptionLocator(email: string) {
    return this.page.getByText(`We did not find an existing account for ${email}`);
  }

  async navigate() {
    await this.page.goto('/settings/account');
  }

  async changeName(newName: string) {
    await this.nameInput.fill(newName);
    await this.page.keyboard.press('Tab'); // triggers a blur event
  }

  async checkEmailAvailability(newEmail: string) {
    await this.navigate();
    await this.changeEmailButton.click();
    await this.newEmailInput.fill(newEmail);
    await this.checkEmailButton.click();
  }
}
