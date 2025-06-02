import {faker} from '@faker-js/faker';
import {Locator, Page, expect} from '@playwright/test';

export class SignupPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly nameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly emailInvalidError: Locator;
  readonly emailAlreadyInUseError: Locator;
  readonly requiredError: Locator;
  readonly nameTooLongError: Locator;
  readonly passwordTooShortError: Locator;
  readonly passwordTooLongError: Locator;
  readonly loginLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId('signup-email-input');
    this.nameInput = page.getByTestId('signup-name-input');
    this.passwordInput = page.getByTestId('password-input');
    this.submitButton = page.getByTestId('signup-submit');
    this.requiredError = page.getByText('Required');
    this.emailInvalidError = page.getByText('Please enter a valid email address.');
    this.emailAlreadyInUseError = page.getByText('This email is already in use');
    this.nameTooLongError = page.getByText('Name must be less than 256 characters.');
    this.passwordTooShortError = page.getByText('Too short. Must be at least 8 characters.');
    this.passwordTooLongError = page.getByText('Too long. Must be less than 256 characters.');
    this.loginLink = page.getByTestId('login-link');
  }

  async navigate() {
    await this.page.goto('/signup');
  }

  async fillAndSubmitForm() {
    const email = faker.internet.email();
    const name = faker.person.fullName();
    const password = faker.internet.password();

    await this.emailInput.fill(email);
    await this.nameInput.fill(name);
    await this.passwordInput.fill(password);

    await expect(this.emailInput).toHaveValue(email);
    await expect(this.nameInput).toHaveValue(name);
    await expect(this.passwordInput).toHaveValue(password);
    await this.submitButton.click();

    return email;
  }
}
