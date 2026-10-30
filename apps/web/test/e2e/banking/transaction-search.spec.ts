import {expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections, mockJson} from '../../utils/api-mocks';

test.use({storageState: {cookies: [], origins: []}});

test('searches with a long description and restores it from the URL', async ({page}) => {
  const description = '€'.repeat(1000);
  const searches: Array<string | null> = [];
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000200',
    name: 'Alex Example',
    email: 'user@example.com',
    isEmailVerified: true,
  });
  await mockBankConnections(page, []);
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    searches.push(new URL(route.request().url()).searchParams.get('filter[search]'));
    return fulfillJson(route, {transactions: [], total: 0});
  });
  await page.goto('/bank-transactions?search=initial&pageIndex=2');
  const search = page.getByRole('textbox', {name: 'Search transactions'});
  await search.fill(description);
  await expect.poll(() => searches[searches.length - 1]).toBe(description);
  await expect(page.getByText('The applied filters did not match any transactions.')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('search')).toBe(description);
  expect(new URL(page.url()).searchParams.get('pageIndex')).toBe('0');

  await page.reload();
  await expect(search).toHaveValue(description);
  await search.fill(`${description}y`);
  await expect(search).toHaveValue(description);
  await expect(page.getByRole('heading', {name: 'Bank transactions', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Clear filters'}).first().click();
  await expect(
    page.getByText('Synchronize a bank connection to make its transactions appear here.'),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has('search')).toBe(false);
});
