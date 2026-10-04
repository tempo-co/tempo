import {Locator, Page} from '@playwright/test';

export class AppearanceSettingsPage {
  readonly page: Page;
  readonly lightThemeButton: Locator;
  readonly darkThemeButton: Locator;
  readonly systemThemeButton: Locator;
  readonly htmlElement: Locator;

  constructor(page: Page) {
    this.page = page;
    this.lightThemeButton = page.getByRole('radio', {name: 'Light'});
    this.darkThemeButton = page.getByRole('radio', {name: 'Dark'});
    this.systemThemeButton = page.getByRole('radio', {name: 'System'});
    this.htmlElement = page.locator('html');
  }

  async navigate() {
    await this.page.goto('/settings/appearance');
  }

  async getStoredTheme() {
    return this.page.evaluate(() => localStorage.getItem('vite-ui-theme'));
  }
}
