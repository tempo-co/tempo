import {createAccount} from '../../data/account.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections, mockJson} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: {cookies: [], origins: []}});

test('searches with a long description and restores it from the URL', async ({page}) => {
  const description = '€'.repeat(1000);
  const searches: Array<string | null> = [];
  await mockJson(
    page,
    '**/accounts/me',
    createAccount({
      id: '00000000-0000-4000-8000-000000000200',
      name: 'Alex Example',
      email: 'user@example.com',
    }),
  );
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
  // The description repeats a long search only in part.
  await expect(page.getByText(`Nothing matches “${description.slice(0, 40)}…”.`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(new URL(page.url()).searchParams.get('search')).toBe(description);
  // The list loads more in place, so an older link's page is dropped.
  expect(new URL(page.url()).searchParams.has('pageIndex')).toBe(false);

  await page.reload();
  await expect(search).toHaveValue(description);
  await search.fill(`${description}y`);
  await expect(search).toHaveValue(description);
  await expect(page.getByRole('heading', {name: 'Bank transactions', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Clear filters'}).first().click();
  await expect(page.getByRole('heading', {name: 'No transactions yet'})).toBeVisible();
  expect(new URL(page.url()).searchParams.has('search')).toBe(false);
});

test('a search within dates that matches nothing widens to all dates', async ({page}) => {
  await mockJson(
    page,
    '**/accounts/me',
    createAccount({
      id: '00000000-0000-4000-8000-000000000202',
      name: 'Alex Example',
      email: 'user@example.com',
    }),
  );
  await page.route('**/bank-transactions?**', (route) =>
    ['fetch', 'xhr'].includes(route.request().resourceType())
      ? fulfillJson(route, {transactions: [], total: 0})
      : route.continue(),
  );
  const october = encodeURIComponent(JSON.stringify({from: '2026-10-01', to: '2026-10-31'}));
  await page.goto(`/bank-transactions?search=bakery&bookingDate=${october}`);

  await expect(page.getByRole('heading', {name: 'No matching transactions'})).toBeVisible();
  await expect(page.getByText('Nothing matches “bakery” with these filters.')).toBeVisible();
  await page.getByRole('button', {name: 'Search all dates'}).click();

  await expect(page).not.toHaveURL(/bookingDate=/);
  expect(new URL(page.url()).searchParams.get('search')).toBe('bakery');
  await expect(page.getByText('Nothing matches “bakery”.')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Search all dates'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Clear filters'})).toBeVisible();
});
