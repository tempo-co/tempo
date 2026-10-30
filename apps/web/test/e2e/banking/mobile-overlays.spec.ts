import {expect, test} from '../../fixtures';
import {mockJson} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: {cookies: [], origins: []}});

test.beforeEach(async ({page}) => {
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Alex Example',
    email: 'user@example.com',
    isEmailVerified: true,
  });
  await mockJson(page, '**/bank-connections/aspsps', [
    {name: 'Example Bank', country: 'NL', logoUrl: null},
  ]);
});

for (const viewport of [
  {width: 320, height: 568},
  {width: 568, height: 320},
]) {
  test(`bank selection and its continuation are reachable at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/bank-connections');
    await page.getByTestId('connect-bank-button').click();
    const picker = page.getByTestId('bank-connection-picker');
    await expect(picker).toBeVisible();
    await picker.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await expectNoHorizontalOverflow(page);
    const bounds = await picker.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await picker.getByRole('combobox', {name: 'Country', exact: true}).click();
    await page.getByRole('option', {name: /Netherlands/}).click();
    await picker.getByRole('combobox', {name: 'Bank', exact: true}).click();
    await page.getByRole('option', {name: /Example Bank/}).click();
    await picker.hover();
    await page.mouse.wheel(0, 1000);
    const confirm = picker.getByTestId('bank-connection-confirm');
    await expect(confirm).toBeInViewport({ratio: 1});
    await expect(confirm).toBeEnabled();
    await expect(confirm).toHaveText('Continue with Example Bank');
    // Cancelling the local picker must not begin provider authorization.
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(page.getByTestId('connect-bank-button')).toBeFocused();
  });
}
