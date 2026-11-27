import {Locator, Page, expect} from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly accountName: Locator;
  readonly accountEmail: Locator;
  readonly settingsLink: Locator;
  readonly logOutButton: Locator;
  readonly welcomeToastTitle: Locator;
  readonly welcomeToastDescription: Locator;
  readonly alreadyVerifiedToastTitle: Locator;
  readonly emptyStateTitle: Locator;
  /** The empty Home's way into the first run: the bank picker. */
  readonly chooseBankButton: Locator;
  readonly paceCard: Locator;
  readonly paceFigure: Locator;
  readonly accountsTotal: Locator;
  /** Insights' table of years, shown over a span with the Table view. */
  readonly yearTable: Locator;

  constructor(page: Page) {
    this.page = page;
    this.accountName = page.getByTestId('current-account-name');
    this.accountEmail = page.getByTestId('current-account-email');
    this.settingsLink = page.getByRole('link', {name: 'Settings', exact: true});
    this.logOutButton = page.getByTestId('log-out-button');
    this.welcomeToastTitle = page.getByText('Welcome to Wisp!');
    this.welcomeToastDescription = page.getByText('Your email has been verified.');
    this.alreadyVerifiedToastTitle = page.getByText('Your email has already been verified.');
    this.emptyStateTitle = page.getByRole('heading', {
      name: 'See where your money goes, from one bank statement',
    });
    this.chooseBankButton = page.getByRole('main').getByRole('button', {name: 'Choose your bank'});
    this.paceCard = this.card('Spending pace');
    this.paceFigure = this.paceCard.getByTestId('pace-figure');
    this.accountsTotal = this.card('Accounts').getByTestId('accounts-card-total');
    this.yearTable = page.getByRole('region', {name: 'Year by year'});
  }

  /** One of Home's cards, by its name ("Spending pace", "Your data", "To do"). */
  card(name: string) {
    return this.page.getByRole('main').getByRole('region', {name, exact: true});
  }

  /** A month's page in Insights, named by its title ("March 2026"). */
  monthPage(title: string) {
    return this.page.getByRole('article', {name: title});
  }

  async expectToBeOnPage() {
    const url = '/';
    await this.page.waitForURL(url);
    await expect(this.page).toHaveURL(url);
  }

  async expectWelcomeMessage() {
    await expect(this.welcomeToastTitle).toBeVisible();
    await expect(this.welcomeToastDescription).toBeVisible();
  }

  async expectUserLoggedIn() {
    await expect(this.accountName).toBeVisible();
    await expect(this.accountEmail).toBeVisible();
  }

  /** Log out lives in Settings › Security, reached from the sidebar's gear or the phone header's. */
  async logOut() {
    await this.settingsLink.click();
    await this.page
      .getByRole('navigation', {name: 'Settings sections'})
      .getByRole('link', {name: /^Security/})
      .click();
    await this.logOutButton.click();
  }
}
