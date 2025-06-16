import {Locator, Page} from '@playwright/test';

export class SecuritySettingsPage {
  readonly page: Page;
  readonly sessionCards: Locator;
  readonly otherSessionCards: Locator;
  readonly currentSessionCard: Locator;
  readonly revokeAllButton: Locator;
  readonly revokeAllButtonConfirm: Locator;
  readonly revokeButton: Locator;
  readonly revokeButtonConfirm: Locator;
  readonly sessionRevokeSuccessToast: Locator;
  readonly logOutButton: Locator;
  readonly logOutButtonConfirm: Locator;

  readonly changePasswordButton: Locator;
  readonly currentPasswordInput: Locator;
  readonly newPasswordInput: Locator;
  readonly confirmPasswordButton: Locator;
  readonly passwordChangedSuccessToast: Locator;
  readonly invalidCurrentPasswordError: Locator;
  readonly requiredError: Locator;
  readonly passwordTooShortError: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sessionCards = page.getByTestId('session-card');
    this.otherSessionCards = page
      .getByTestId('session-card')
      .and(page.locator('[data-current-session="false"]'));
    this.currentSessionCard = page
      .getByTestId('session-card')
      .and(page.locator('[data-current-session="true"]'));
    this.revokeAllButton = this.page.getByTestId('revoke-all-sessions-button');
    this.revokeAllButtonConfirm = this.page.getByTestId('revoke-all-sessions-button-confirm');
    this.revokeButton = this.page.getByTestId('revoke-session-button');
    this.revokeButtonConfirm = this.page.getByTestId('revoke-session-button-confirm');
    this.sessionRevokeSuccessToast = this.page.getByText('Session revoked.');
    this.logOutButton = this.page.getByTestId('log-out-button-session');
    this.logOutButtonConfirm = this.page.getByTestId('log-out-button-session-confirm');

    this.changePasswordButton = page.getByTestId('change-password-button');
    this.currentPasswordInput = page.getByTestId('password-input').nth(0);
    this.newPasswordInput = page.getByTestId('password-input').nth(1);
    this.confirmPasswordButton = page.getByTestId('change-password-confirm');
    this.passwordChangedSuccessToast = page.getByText('Password changed.');
    this.invalidCurrentPasswordError = page.getByText('Invalid current password.');
    this.requiredError = page.getByText('Required');
    this.passwordTooShortError = page.getByText('Too short. Must be at least 8 characters.');
  }

  async navigate() {
    await this.page.goto('/settings/security');
  }

  async changePassword(current: string, newPass: string) {
    await this.changePasswordButton.click();
    await this.currentPasswordInput.fill(current);
    await this.newPasswordInput.fill(newPass);
    await this.confirmPasswordButton.click();
  }
}
