import {Locator, Page} from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly requiredError: Locator;
  readonly invalidCredentialsError: Locator;
  readonly forgotPasswordLink: Locator;
  readonly signupLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId('login-email-input');
    this.passwordInput = page.getByTestId('password-input');
    this.submitButton = page.getByTestId('login-submit');
    this.requiredError = page.getByText('Required');
    this.invalidCredentialsError = page.getByText('Invalid email or password.');
    this.forgotPasswordLink = page.getByTestId('forgot-password-link');
    this.signupLink = page.getByTestId('signup-link');
  }

  async navigate() {
    await this.page.goto('/login');
  }

  async login(email: string, password?: string) {
    await this.emailInput.fill(email);
    if (password) {
      await this.passwordInput.fill(password);
    }
    await this.submitButton.click();
  }
}
