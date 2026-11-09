import type {Locator, Page} from '@playwright/test';
import type {BankConnection, BankConnectionAspsp} from '@tempo/contracts';

import {HOME_CONNECTION} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {
  fulfillJson,
  mockBankConnections,
  mockJson,
  routeBankConnectionsApi,
} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: {cookies: [], origins: []}});

const AUTHORIZATION_URL = 'https://auth.example.test/consent';

/** A wide wordmark, the shape the bank provider ships its logos in. */
const wordmark = (text: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><text x="0" y="76" font-family="Arial" font-size="80" font-weight="700" fill="#1d3b8f">${text}</text></svg>`,
  )}`;

const BANKS: BankConnectionAspsp[] = [
  {name: 'Example Bank', country: 'NL', logoUrl: wordmark('EXAMPLE')},
  {name: 'Example Savings Bank', country: 'NL', logoUrl: wordmark('SAVINGS')},
  {name: 'Örnsköld Example Bank', country: 'NL'},
  ...Array.from({length: 12}, (_, index) => ({
    name: `Example Regional Bank ${index + 1}`,
    country: 'NL',
  })),
  {name: 'Esimerkki Pankki', country: 'FI', logoUrl: wordmark('ESIMERKKI')},
  {name: 'Demo Pankki', country: 'FI'},
  {name: 'Beispielbank', country: 'DE'},
  {name: 'Musterbank', country: 'AT'},
];

const LONG_NAME =
  'Raiffeisenbank Example-Musterstadt-Beispieldorf eG Genossenschaftliche Privatkundenfiliale Nord';
const UNBROKEN_NAME = 'Volksbankbeispielmusterstadtgenossenschaftsbankfiliale';
const BROKEN_LOGO_URL = 'https://logos.example.test/missing-wordmark.png';

/** Worst cases: long and unbroken names, missing and failing logos, a long list and a country without a flag. */
const WORST_CASE_BANKS: BankConnectionAspsp[] = [
  {name: LONG_NAME, country: 'DE'},
  {name: UNBROKEN_NAME, country: 'DE', logoUrl: wordmark('VOLKSBANKBEISPIEL')},
  {name: 'Q', country: 'DE'},
  {name: 'Broken Logo Example Bank', country: 'DE', logoUrl: BROKEN_LOGO_URL},
  ...Array.from({length: 246}, (_, index) => ({
    name: `Example Regional Bank ${String(index + 1).padStart(3, '0')}`,
    country: 'DE',
  })),
  {name: 'Shembull Bank', country: 'XK'},
  {name: 'Beispiel Kantonalbank', country: 'CH'},
  {name: 'Example Pacific Bank', country: 'QO'},
  {name: 'Example Bank', country: 'NL', logoUrl: wordmark('EXAMPLE')},
];

const connectionIn = (country: string, index: number): BankConnection => ({
  ...HOME_CONNECTION,
  id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
  aspspCountry: country,
});

async function mockPickerPage(
  page: Page,
  {
    banks = BANKS,
    connections = [connectionIn('NL', 0)],
  }: {banks?: BankConnectionAspsp[]; connections?: BankConnection[]} = {},
) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Alex Example',
    email: 'user@example.com',
    isEmailVerified: true,
  });
  await mockBankConnections(page, connections);
  await mockJson(page, '**/bank-connections/*/refresh', {});
  await mockJson(page, '**/bank-connections/aspsps', banks);
  const authorizations: unknown[] = [];
  await page.route('**/bank-connections/authorize', async (route) => {
    authorizations.push(route.request().postDataJSON());
    await fulfillJson(route, {authorizationUrl: AUTHORIZATION_URL}, 201);
  });
  await page.route(AUTHORIZATION_URL, (route) =>
    route.fulfill({status: 200, contentType: 'text/html', body: '<p>Example bank consent</p>'}),
  );
  return authorizations;
}

/** The search field is never focused for the user, so no ring shows and phones keep the keyboard closed. */
async function expectNothingFocused(picker: Locator) {
  expect(await picker.evaluate((element) => element.ownerDocument.activeElement?.tagName)).not.toBe(
    'INPUT',
  );
  expect(await picker.locator(':focus-visible').count()).toBe(0);
}

/** Every list row is 56px tall, and rows keep 10px clear of the list's scrollbar. */
async function expectListRows(picker: Locator) {
  const rows = picker.getByRole('list').getByRole('button');
  const heights = await rows.evaluateAll((elements) => [
    ...new Set(elements.map((element) => Math.round(element.getBoundingClientRect().height))),
  ]);
  expect(heights).toEqual([56]);
  const scrollbar = picker.locator('[data-orientation="vertical"]');
  await expect(scrollbar).toBeVisible();
  const [bar, row] = await Promise.all([boxOf(scrollbar), boxOf(rows.first())]);
  expect(bar.x - (row.x + row.width)).toBeGreaterThanOrEqual(10);
}

/** A flat 4:3 flag at 28×21 with rounded corners. */
async function expectFlag(scope: Locator) {
  const flag = scope.locator('img');
  await expect(flag).toBeVisible();
  await expect
    .poll(() => flag.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const tile = flag.locator('..');
  expect(await boxOf(tile)).toMatchObject({width: 28, height: 21});
  expect(
    parseFloat(await tile.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)),
  ).toBeGreaterThan(0);
}

const sheetHeight = async (picker: Locator) => Math.round((await boxOf(picker)).height);

test.describe('Connect a bank', () => {
  test('connects a bank: the likely country, search, another country, confirmation, then the bank', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    const authorizations = await mockPickerPage(page);
    let releaseBanks!: () => void;
    const banksHeld = new Promise<void>((resolve) => (releaseBanks = resolve));
    await page.route('**/bank-connections/aspsps', async (route) => {
      await banksHeld;
      await route.fallback();
    });
    let releaseAuthorization!: () => void;
    const authorizationHeld = new Promise<void>((resolve) => (releaseAuthorization = resolve));
    await page.route('**/bank-connections/authorize', async (route) => {
      await authorizationHeld;
      await route.fallback();
    });

    await page.goto('/bank-connections');
    await page.getByTestId('connect-bank-button').click();
    const picker = page.getByTestId('bank-connection-picker');
    await expect(picker.getByRole('heading', {name: 'Connect a bank'})).toBeVisible();
    await expect(picker.getByRole('status')).toHaveText('Loading banks…');
    const height = await sheetHeight(picker);

    releaseBanks();
    // The country of the connected bank comes first.
    const country = picker.getByTestId('bank-connection-country');
    await expect(country).toHaveText('NetherlandsChange');
    await expectFlag(country);
    expect(await sheetHeight(picker)).toBe(height);
    await expectNothingFocused(picker);
    const search = picker.getByRole('searchbox', {name: 'Search banks in Netherlands'});
    await expect(search).toHaveAttribute('placeholder', 'Search 15 banks');
    await expectListRows(picker);
    await expect(picker.getByTestId('bank-wordmark').first()).toBeVisible();
    expect(await boxOf(picker.getByTestId('bank-wordmark').first())).toMatchObject({
      width: 112,
      height: 36,
    });

    await search.fill('ornskold');
    const found = picker.getByRole('list').getByRole('button');
    await expect(found).toHaveCount(1);
    await expect(found).toHaveAccessibleName('Örnsköld Example Bank');
    await search.fill('Example Credit');
    await expect(picker.getByText('No bank called “Example Credit” in Netherlands')).toBeVisible();
    await search.fill('');

    await country.click();
    await expect(picker.getByRole('heading', {name: 'Choose a country'})).toBeVisible();
    expect(await sheetHeight(picker)).toBe(height);
    await expectNothingFocused(picker);
    const countries = picker.getByRole('list').getByRole('button');
    await expect(countries).toHaveText([
      'Austria1 bank',
      'Finland2 banks',
      'Germany1 bank',
      'Netherlands15 banks',
    ]);
    await expect(countries.filter({hasText: 'Netherlands'})).toHaveAttribute(
      'aria-current',
      'true',
    );
    for (const row of await countries.all()) await expectFlag(row);
    await picker.getByRole('searchbox', {name: 'Search countries'}).fill('fin');
    await expect(countries).toHaveText(['Finland2 banks']);
    await countries.first().click();

    await expect(country).toHaveText('FinlandChange');
    expect(await sheetHeight(picker)).toBe(height);
    await expectNothingFocused(picker);
    await picker.getByRole('button', {name: 'Esimerkki Pankki', exact: true}).click();

    await expect(picker.getByRole('heading', {name: 'Connect Esimerkki Pankki'})).toBeVisible();
    expect(await sheetHeight(picker)).toBe(height);
    await expectNothingFocused(picker);
    expect(await boxOf(picker.getByTestId('bank-wordmark'))).toMatchObject({
      width: 192,
      height: 56,
    });
    await expect(picker.getByText('Finland', {exact: true})).toBeVisible();
    await expect(
      picker.getByText('You approve access at Esimerkki Pankki, then come back here.'),
    ).toBeVisible();
    await picker.getByRole('button', {name: 'Back'}).click();
    await expect(country).toHaveText('FinlandChange');
    await picker.getByRole('button', {name: 'Esimerkki Pankki', exact: true}).click();

    const confirm = picker.getByTestId('bank-connection-confirm');
    await expect(confirm).toHaveText('Continue to Esimerkki Pankki');
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveText('Taking you to Esimerkki Pankki…');
    releaseAuthorization();
    await expect(page).toHaveURL(AUTHORIZATION_URL);
    expect(authorizations).toEqual([{aspspName: 'Esimerkki Pankki', aspspCountry: 'FI'}]);
  });

  for (const {name, locale, connections, expected, placeholder} of [
    {
      name: 'the country of most connected banks',
      locale: 'en-NL',
      connections: [connectionIn('DE', 1), connectionIn('DE', 2), connectionIn('NL', 3)],
      expected: 'Germany',
      placeholder: 'Search 1 bank',
    },
    {
      name: "the browser's region without connected banks",
      locale: 'en-FI',
      connections: [],
      expected: 'Finland',
      placeholder: 'Search 2 banks',
    },
    {
      name: 'the first country when the browser region has no banks',
      locale: 'en-US',
      connections: [],
      expected: 'Austria',
      placeholder: 'Search 1 bank',
    },
  ]) {
    test.describe(`in ${locale}`, () => {
      test.use({locale});

      test(`starts with ${name}`, async ({page}) => {
        await mockPickerPage(page, {connections});
        await page.goto('/bank-connections');
        await page.getByTestId('connect-bank-button').click();
        const picker = page.getByTestId('bank-connection-picker');
        await expect(picker.getByTestId('bank-connection-country')).toHaveText(`${expected}Change`);
        await expect(picker.getByRole('searchbox')).toHaveAttribute('placeholder', placeholder);
      });
    });
  }

  test.describe('in en-NL', () => {
    test.use({locale: 'en-NL'});

    test('keeps the country the user started in when connected banks load later', async ({
      page,
    }) => {
      await mockPickerPage(page, {connections: [connectionIn('DE', 1), connectionIn('DE', 2)]});
      let releaseConnections!: () => void;
      const connectionsHeld = new Promise<void>((resolve) => (releaseConnections = resolve));
      await routeBankConnectionsApi(page, async (route) => {
        await connectionsHeld;
        await route.fallback();
      });
      await page.goto('/bank-connections');
      await page.getByTestId('connect-bank-button').click();
      const picker = page.getByTestId('bank-connection-picker');
      const country = picker.getByTestId('bank-connection-country');
      // Without connected banks yet, the browser's region is the guess.
      await expect(country).toHaveText('NetherlandsChange');
      const search = picker.getByRole('searchbox', {name: 'Search banks in Netherlands'});
      await search.fill('savings');

      const loaded = page.waitForResponse((response) =>
        response.url().endsWith('/bank-connections'),
      );
      releaseConnections();
      await loaded;
      await expect(page.getByTestId('bank-connections-loading')).toHaveCount(0);
      await expect(country).toHaveText('NetherlandsChange');
      await expect(search).toHaveValue('savings');
    });
  });

  test('closing the sheet starts nothing, and reopening starts at the bank list in the chosen country', async ({
    page,
  }) => {
    const authorizations = await mockPickerPage(page);
    await page.goto('/bank-connections');
    const trigger = page.getByTestId('connect-bank-button');
    await trigger.click();
    const picker = page.getByTestId('bank-connection-picker');
    await picker.getByTestId('bank-connection-country').click();
    await picker.getByRole('button', {name: /^Finland/}).click();
    await picker.getByRole('button', {name: 'Demo Pankki', exact: true}).click();
    await expect(picker.getByRole('heading', {name: 'Connect Demo Pankki'})).toBeVisible();

    // The page's connection list fails to refresh behind the sheet; the sheet stays where it was.
    await mockJson(page, '**/bank-connections', {message: 'Unavailable'}, 500);
    const refreshed = page.waitForResponse(
      (response) => response.url().endsWith('/bank-connections') && response.status() === 500,
    );
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await refreshed;
    // By text: the open sheet hides the page from the accessibility tree.
    await expect(page.getByText('Could not load bank connections')).toBeVisible();
    await expect(picker.getByRole('heading', {name: 'Connect Demo Pankki'})).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(picker).toBeVisible();
    // Read once, straight away: the sheet opens on the bank list, not on the step it was closed on.
    expect(await picker.getByRole('heading').first().textContent()).toBe('Connect a bank');
    await expect(picker.getByTestId('bank-connection-country')).toHaveText('FinlandChange');
    expect(authorizations).toEqual([]);
  });

  test('offers a retry when the bank list cannot load', async ({page}) => {
    await mockPickerPage(page);
    let available = false;
    await page.route('**/bank-connections/aspsps', async (route) => {
      if (available) return route.fallback();
      await fulfillJson(route, {message: 'Unavailable'}, 500);
    });
    await page.goto('/bank-connections');
    await page.getByTestId('connect-bank-button').click();
    const picker = page.getByTestId('bank-connection-picker');
    await expect(picker.getByRole('alert')).toContainText('Supported banks are unavailable.');
    const height = await sheetHeight(picker);

    available = true;
    await picker.getByRole('button', {name: 'Try again'}).click();
    await expect(picker.getByTestId('bank-connection-country')).toHaveText('NetherlandsChange');
    expect(await sheetHeight(picker)).toBe(height);
  });

  test('counts one country in the singular', async ({page}) => {
    await mockPickerPage(page, {banks: [{name: 'Beispielbank', country: 'DE'}]});
    await page.goto('/bank-connections');
    await page.getByTestId('connect-bank-button').click();
    const picker = page.getByTestId('bank-connection-picker');
    await picker.getByTestId('bank-connection-country').click();
    await expect(picker.getByRole('searchbox', {name: 'Search countries'})).toHaveAttribute(
      'placeholder',
      'Search 1 country',
    );
  });

  test('says so when the provider offers no banks', async ({page}) => {
    await mockPickerPage(page, {banks: []});
    await page.goto('/bank-connections');
    await page.getByTestId('connect-bank-button').click();
    const picker = page.getByTestId('bank-connection-picker');
    await expect(picker.getByText('No banks are available to connect right now.')).toBeVisible();
    await expect(picker.getByRole('status')).toHaveCount(0);
  });

  test.describe('on a touch phone', () => {
    test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

    test('a finger scrolls the bank list and leaves the drawer in place', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'Touch gestures are sent with Chromium DevTools.');
      await mockPickerPage(page, {banks: WORST_CASE_BANKS, connections: []});
      await page.goto('/bank-connections');
      await page.getByTestId('connect-bank-button').click();
      const picker = page.getByTestId('bank-connection-picker');
      await expect(picker.getByTestId('bank-connection-country')).toHaveText('GermanyChange');
      const viewport = picker.locator('[data-radix-scroll-area-viewport]');
      const [list, sheet] = await Promise.all([boxOf(viewport), boxOf(picker)]);

      const cdp = await page.context().newCDPSession(page);
      const x = list.x + list.width / 2;
      const [from, to] = [list.y + list.height - 40, list.y + 40];
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y: from}]});
      for (let step = 1; step <= 10; step++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{x, y: from + ((to - from) * step) / 10}],
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

      await expect
        .poll(() => viewport.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(200);
      expect((await boxOf(picker)).y).toBe(sheet.y);
    });
  });

  for (const {width, theme} of [
    {width: 1440, theme: 'light'},
    {width: 390, theme: 'dark'},
    {width: 320, theme: 'light'},
  ]) {
    test(`keeps worst-case banks and countries inside the sheet at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({width, height: 844});
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      await mockPickerPage(page, {banks: WORST_CASE_BANKS, connections: []});
      await page.route(BROKEN_LOGO_URL, (route) => route.fulfill({status: 404, body: ''}));
      await page.route('**/assets/nl-*.svg', (route) => route.fulfill({status: 404, body: ''}));
      await page.goto('/bank-connections');
      await page.getByTestId('connect-bank-button').click();
      const picker = page.getByTestId('bank-connection-picker');
      const country = picker.getByTestId('bank-connection-country');
      await expect(country).toHaveText('GermanyChange');
      const height = await sheetHeight(picker);
      const pickerBox = await boxOf(picker);
      await expectNoHorizontalOverflow(page);
      await expectListRows(picker);

      const rows = picker.getByRole('list').getByRole('button');
      for (const name of [LONG_NAME, UNBROKEN_NAME, 'Q', 'Broken Logo Example Bank']) {
        const row = rows.filter({hasText: name});
        const [plate, label, chevron] = await Promise.all([
          boxOf(row.locator('xpath=./span[1]')),
          boxOf(row.locator('xpath=./span[2]')),
          boxOf(row.locator('svg').last()),
        ]);
        // Wordmarks and initials share one plate, so the names line up.
        expect(plate).toMatchObject({width: 112, height: 36});
        expect(label.x + label.width).toBeLessThanOrEqual(chevron.x);
        expect(chevron.x + chevron.width).toBeLessThanOrEqual(pickerBox.x + pickerBox.width);
      }
      await expect(rows.filter({hasText: 'Broken Logo Example Bank'})).toContainText('BL');
      await expect(rows.filter({hasText: /^Q/})).toContainText('Q');

      // The whole long list scrolls inside the sheet.
      const last = rows.filter({hasText: 'Example Regional Bank 246'});
      await rows.first().hover();
      await page.mouse.wheel(0, 20_000);
      await expect(last).toBeInViewport({ratio: 1});
      expect(await sheetHeight(picker)).toBe(height);

      await country.click();
      const countries = picker.getByRole('list');
      for (const name of [/^Germany/, /^Kosovo/, /^Switzerland/])
        await expectFlag(countries.getByRole('button', {name}));
      // A country without a flag, and a flag that fails to load, show the code in the flag's box.
      for (const [name, code] of [
        [/^Outlying Oceania/, 'QO'],
        [/^Netherlands/, 'NL'],
      ] as const)
        expect(
          await boxOf(countries.getByRole('button', {name}).getByText(code, {exact: true})),
        ).toMatchObject({width: 28, height: 21});
      await expectNoHorizontalOverflow(page);
      expect(await sheetHeight(picker)).toBe(height);
      await picker.getByRole('button', {name: /^Germany/}).click();

      await rows.filter({hasText: LONG_NAME}).click();
      const confirm = picker.getByTestId('bank-connection-confirm');
      await expect(confirm).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(await sheetHeight(picker)).toBe(height);
      const confirmBox = await boxOf(confirm);
      expect(confirmBox.x).toBeGreaterThanOrEqual(pickerBox.x + 16);
      expect(confirmBox.x + confirmBox.width).toBeLessThanOrEqual(
        pickerBox.x + pickerBox.width - 16,
      );
      await expect(confirm).toBeInViewport({ratio: 1});
      // The long name's title stays on one line inside the sheet, clear of the close button.
      const title = picker.getByRole('heading', {name: `Connect ${LONG_NAME}`});
      const titleBox = await boxOf(title);
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(pickerBox.x + pickerBox.width - 16);
      const close = picker.getByRole('button', {name: 'Close'});
      if (await close.isVisible())
        expect(titleBox.x + titleBox.width).toBeLessThanOrEqual((await boxOf(close)).x);

      // A name without spaces still wraps inside the button and the hint.
      await picker.getByRole('button', {name: 'Back'}).click();
      await rows.filter({hasText: UNBROKEN_NAME}).click();
      await expect(confirm).toHaveText(`Continue to ${UNBROKEN_NAME}`);
      for (const element of [confirm, picker.getByText(`You approve access at ${UNBROKEN_NAME}`)]) {
        const box = await boxOf(element);
        expect(box.x + box.width).toBeLessThanOrEqual(pickerBox.x + pickerBox.width - 16);
        expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
      expect(await sheetHeight(picker)).toBe(height);
    });
  }
});
