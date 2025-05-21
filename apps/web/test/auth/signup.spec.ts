import {faker} from '@faker-js/faker';
import {test} from '@playwright/test';

import {SignupPage} from './signup.page';

test.describe('Signup', () => {
  let signupPage: SignupPage;

  test.beforeEach(async ({page}) => {
    signupPage = new SignupPage(page);
    await signupPage.navigate();
  });

  test('should successfully create a new account', async () => {
    const email = faker.internet.email();
    const name = faker.person.fullName();
    const password = faker.internet.password();

    await signupPage.fillEmail(email);
    await signupPage.fillName(name);
    await signupPage.fillPassword(password);

    await signupPage.expectFilledValues(email, name, password);

    await signupPage.submit();
    await signupPage.expectRedirectToVerify();
  });
});
