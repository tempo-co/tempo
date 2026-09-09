import {expect, test} from '@playwright/test';

import {PW_CHANGE_USER_AUTH_FILE, VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';

const DETAIL_TRANSACTION_ID = '00000000-0000-4000-8000-000000000014';

test.describe('bank connections', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('shows seeded connection data and callback success feedback', async ({page}) => {
    await page.goto('/bank-connections?result=connected');

    await expect(page.getByRole('heading', {name: 'Bank connections'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'ABN AMRO'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Accounts'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Recent transactions'})).toBeVisible();
    await expect(page.getByText('Connected', {exact: true})).toBeVisible();
    await expect(page.getByTestId('bank-connection-freshness')).toContainText('Updated');
    const status = page.getByTestId('bank-connection-status');
    const freshness = page.getByTestId('bank-connection-freshness');
    const syncButton = page.getByRole('button', {name: 'Sync now'});
    const [statusBox, freshnessBox, syncButtonBox] = await Promise.all([
      status.boundingBox(),
      freshness.boundingBox(),
      syncButton.boundingBox(),
    ]);
    expect(statusBox).not.toBeNull();
    expect(freshnessBox).not.toBeNull();
    expect(syncButtonBox).not.toBeNull();
    const verticalCenters = [statusBox!, freshnessBox!, syncButtonBox!].map(
      (box) => box.y + box.height / 2,
    );
    expect(Math.max(...verticalCenters) - Math.min(...verticalCenters)).toBeLessThan(1);
    await expect(page.getByText('Daily spending', {exact: true})).toBeVisible();
    await expect(page.getByText('available · primary')).toBeVisible();
    await expect(page.getByText('Provider purchase')).toBeVisible();
    const transactionTrigger = page.getByRole('button', {
      name: 'View transaction details for Provider purchase',
    });
    await expect(transactionTrigger).toBeVisible();
    await transactionTrigger.click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector).toBeVisible();
    expect(new URL(page.url()).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);
    await expect(inspector.getByRole('heading', {name: 'Provider purchase'})).toBeVisible();
    await expect(inspector.getByText('Bank transaction', {exact: true})).toBeVisible();
    await inspector.getByRole('button', {name: 'Close transaction details'}).click();
    await expect(inspector).toBeHidden();
    await expect(transactionTrigger).toBeFocused();
    expect(new URL(page.url()).searchParams.has('transactionId')).toBe(false);
    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(/\/bank-connections$/);
  });

  test('reports when synchronization finds no new transactions', async ({page}) => {
    await page.route('**/bank-connections/*/sync', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-000000000099',
          status: 'SUCCEEDED',
          startedAt: '2026-09-09T00:00:00.000Z',
          finishedAt: '2026-09-09T00:00:01.000Z',
          requestedFrom: '2026-09-02',
          requestedTo: '2026-09-09',
          accountsFetched: 1,
          balancesFetched: 1,
          transactionsFetched: 17,
          transactionsAdded: 0,
          errorMessage: null,
          rateLimitSource: null,
          retryAfterSeconds: null,
        }),
      });
    });

    await page.goto('/bank-connections');
    await page.getByRole('button', {name: 'Sync now'}).click();

    await expect(page.getByText('Sync complete', {exact: true})).toBeVisible();
    await expect(page.getByText('No new transactions found.', {exact: true})).toBeVisible();
  });

  test('reopens a connection transaction inspector from its shareable URL', async ({page}) => {
    await page.goto('/bank-connections');

    const transactionTrigger = page.getByRole('button', {
      name: 'View transaction details for Provider purchase',
    });
    await transactionTrigger.click();

    const sharedUrl = page.url();
    expect(new URL(sharedUrl).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);

    await page.goto(sharedUrl);
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', {name: 'Provider purchase'})).toBeVisible();
    expect(new URL(page.url()).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);
  });

  test('returns to the installed app after bank authorization', async ({page, context}) => {
    await page.goto('/bank-connections');
    const authorizationUrl = 'https://bank.example.test/mock-bank-authorization';
    const callbackUrl = new URL('./bank-connections?result=connected', page.url()).toString();
    await page.route('**/bank-connections/authorize', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({authorizationUrl}),
      });
    });
    await context.route('**/mock-bank-authorization', async (route) => {
      await route.fulfill({status: 302, headers: {location: callbackUrl}});
    });

    let popupOpened = false;
    page.on('popup', () => {
      popupOpened = true;
    });

    await page.getByTestId('connect-abn-amro-button').click();

    await expect(page.getByText('Bank connection added')).toBeVisible();
    await expect(page).toHaveURL(/\/bank-connections$/);
    expect(popupOpened).toBe(false);
  });

  test('keeps the connection overview usable at phone widths', async ({page}) => {
    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-connections');

    const heading = page.getByRole('heading', {name: 'Bank connections'});
    const headingGroup = page.getByTestId('bank-connections-heading');
    const connectButton = page
      .getByRole('button', {name: /^Connect (ABN AMRO|Mock ASPSP)$/})
      .first();
    const syncButton = page.getByRole('button', {name: 'Sync now'});
    const status = page.getByTestId('bank-connection-status');
    const freshness = page.getByTestId('bank-connection-freshness');

    await expect(heading).toBeVisible();
    await expect(connectButton).toBeVisible();
    await expect(syncButton).toBeVisible();
    await expect(page.getByText('Daily spending', {exact: true})).toBeVisible();

    const [headingBox, headingGroupBox, connectButtonBox, syncButtonBox, statusBox, freshnessBox] =
      await Promise.all([
        heading.boundingBox(),
        headingGroup.boundingBox(),
        connectButton.boundingBox(),
        syncButton.boundingBox(),
        status.boundingBox(),
        freshness.boundingBox(),
      ]);
    expect(headingBox).not.toBeNull();
    expect(headingGroupBox).not.toBeNull();
    expect(connectButtonBox).not.toBeNull();
    expect(syncButtonBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(freshnessBox).not.toBeNull();
    expect(headingBox!.height).toBe(32);
    expect(headingGroupBox!.height).toBeLessThan(120);
    expect(connectButtonBox!.x).toBe(16);
    expect(syncButtonBox!.height).toBeGreaterThanOrEqual(44);
    const statusCenter = statusBox!.y + statusBox!.height / 2;
    const freshnessCenter = freshnessBox!.y + freshnessBox!.height / 2;
    const syncCenter = syncButtonBox!.y + syncButtonBox!.height / 2;
    expect(
      Math.max(statusCenter, freshnessCenter, syncCenter) -
        Math.min(statusCenter, freshnessCenter, syncCenter),
    ).toBeLessThan(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);

    const sidebarTrigger = page.locator('[data-sidebar="trigger"]');
    await sidebarTrigger.click();
    const mobileSidebar = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
    await expect(mobileSidebar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(mobileSidebar).toBeHidden();
    await expect(sidebarTrigger).toBeFocused();
  });

  test('keeps the connection overview within a narrow phone viewport', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/bank-connections');

    const connectionCard = page.locator('[data-testid^="bank-connection-"]').first();
    const syncButton = page.getByRole('button', {name: 'Sync now'});
    const sidebarTrigger = page.locator('[data-sidebar="trigger"]');

    await expect(page.getByRole('heading', {name: 'Accounts'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Transactions'})).toBeVisible();
    await expect(syncButton).toBeVisible();
    await expect(sidebarTrigger).toBeVisible();

    const [connectionCardBox, syncButtonBox, sidebarTriggerBox] = await Promise.all([
      connectionCard.boundingBox(),
      syncButton.boundingBox(),
      sidebarTrigger.boundingBox(),
    ]);
    expect(connectionCardBox).not.toBeNull();
    expect(syncButtonBox).not.toBeNull();
    expect(sidebarTriggerBox).not.toBeNull();
    expect(connectionCardBox!.x + connectionCardBox!.width).toBeLessThanOrEqual(320);
    expect(syncButtonBox!.height).toBeGreaterThanOrEqual(44);
    expect(sidebarTriggerBox!.height).toBeGreaterThanOrEqual(44);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test('supports enlarged text without horizontal overflow', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/bank-connections');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    const connectButton = page
      .getByRole('button', {name: /^Connect (ABN AMRO|Mock ASPSP)$/})
      .first();
    const connectButtonBox = await connectButton.boundingBox();

    expect(connectButtonBox).not.toBeNull();
    expect(connectButtonBox!.x + connectButtonBox!.width).toBeLessThanOrEqual(320);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
});

test.describe('bank connection loading errors', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('shows a retryable error when connections cannot load', async ({page}) => {
    let connectionRequests = 0;
    await page.route('**/bank-connections', async (route) => {
      if (route.request().resourceType() === 'document') {
        await route.continue();
        return;
      }

      connectionRequests += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({message: 'Service unavailable'}),
      });
    });

    await page.goto('/bank-connections');

    await expect(page.getByRole('heading', {name: 'Bank connections', exact: true})).toBeVisible();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('heading', {name: 'Could not load bank connections'}),
    ).toBeVisible();
    const retryButton = page.getByTestId('bank-connections-retry');
    await expect(retryButton).toBeVisible();
    const retryButtonBox = await retryButton.boundingBox();
    expect(retryButtonBox).not.toBeNull();
    expect(retryButtonBox!.height).toBeGreaterThanOrEqual(44);
    expect(connectionRequests).toBe(1);
  });
});

test.describe('bank connections without bank connections', () => {
  test.use({storageState: PW_CHANGE_USER_AUTH_FILE});

  test('shows the connect prompt without bank connections', async ({page}) => {
    await page.goto('/bank-connections');

    await expect(page.getByRole('heading', {name: 'No bank connections'})).toBeVisible();
    await expect(page.getByRole('button', {name: /^Connect (ABN AMRO|Mock ASPSP)$/})).toHaveCount(
      1,
    );
  });
});
