import {faker} from '@faker-js/faker';
import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {VERIFIED_ACCOUNT_EMAIL} from 'test/constants/seed.constants';
import {EmailUtils} from 'test/utils/email-utils';

import {expect, test} from '../../fixtures';

test.describe('Signup', () => {
  test.beforeEach(async ({signupPage}) => {
    await EmailUtils.clearEmails();
    await signupPage.navigate();
  });

  test.describe('Successful signup flow', () => {
    test('should create account, verify email via CODE, and land on home page', async ({
      signupPage,
      verifyEmailPage,
      homePage,
    }) => {
      const email = await signupPage.fillAndSubmitForm();

      await verifyEmailPage.expectToBeOnPage();
      await verifyEmailPage.inputCodeAndSubmit(await EmailUtils.getVerificationCode(email));

      await homePage.expectToBeOnPage();
      await homePage.expectWelcomeMessage();
      await homePage.expectUserLoggedIn();
    });

    test('should create account, verify email via LINK, and land on home page', async ({
      page,
      signupPage,
      verifyEmailPage,
      homePage,
    }) => {
      const email = await signupPage.fillAndSubmitForm();

      await verifyEmailPage.expectToBeOnPage();
      const message = await EmailUtils.findEmailByRecipient(email);
      const verificationLink = EmailUtils.extractOnboardingVerifyEmailLink(message?.Text);
      await page.goto(verificationLink);

      await homePage.expectToBeOnPage();
      await homePage.expectWelcomeMessage();
      await homePage.expectUserLoggedIn();

      // Try reusing the link
      await page.goto(verificationLink);
      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();
      await expect(homePage.alreadyVerifiedToastTitle).toBeVisible();
    });

    test('should redirect to login on link click', async ({page, signupPage}) => {
      await signupPage.loginLink.click();
      expect(page.url()).toContain('/login');
    });
  });

  test.describe('Signup (Authenticated)', () => {
    test.use({storageState: VERIFIED_USER_AUTH_FILE});

    test('should redirect to home if a logged in user navigates to /signup', async ({
      page,
      signupPage,
      homePage,
    }) => {
      await signupPage.navigate();
      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();

      expect(page.url()).not.toContain('/signup');
    });
  });

  test.describe('Validation errors', () => {
    test('should show error for email already in use', async ({signupPage}) => {
      await signupPage.emailInput.fill(VERIFIED_ACCOUNT_EMAIL);
      await signupPage.nameInput.fill(faker.person.fullName());
      await signupPage.passwordInput.fill(faker.internet.password());
      await signupPage.submitButton.click();

      await expect(signupPage.emailAlreadyInUseError).toBeVisible();
    });

    test('should show a required error for each empty field', async ({signupPage}) => {
      await signupPage.submitButton.click();
      await expect(signupPage.requiredError).toHaveCount(3);
    });

    for (const {name, field, value, error} of [
      {
        name: 'password too short',
        field: 'passwordInput',
        value: '123',
        error: 'passwordTooShortError',
      },
      {
        name: 'password too long',
        field: 'passwordInput',
        value: faker.string.alphanumeric(256),
        error: 'passwordTooLongError',
      },
      {
        name: 'invalid email format',
        field: 'emailInput',
        value: 'invalid-email',
        error: 'emailInvalidError',
      },
      {
        name: 'name too long',
        field: 'nameInput',
        value: faker.string.alphanumeric(256),
        error: 'nameTooLongError',
      },
    ] as const) {
      test(`should show error for ${name}`, async ({signupPage}) => {
        await signupPage[field].fill(value);
        await signupPage.submitButton.click();
        await expect(signupPage[error]).toBeVisible();
      });
    }
  });
});
