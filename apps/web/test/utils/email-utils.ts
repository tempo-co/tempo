import {loadEnv} from 'vite';

type Message = {
  ID: string;
  To: {Address: string}[];
};

export class EmailUtils {
  static readonly EMAIL_UI_URL = loadEnv('development', process.cwd(), '').VITE_EMAIL_UI_URL;

  static async clearEmails() {
    await fetch(`${this.EMAIL_UI_URL}/api/v1/messages`, {method: 'DELETE'});
  }

  static async extractCodeFromEmail(email: string) {
    const message = await this._findEmailByRecipient(email);
    return this._extractCode(message?.Text);
  }

  static async extractLinkFromEmail(email: string) {
    const message = await this._findEmailByRecipient(email);
    return this._extractLink(message?.Text);
  }

  private static async _findEmailByRecipient(recipientEmail: string) {
    let retries = 10;
    const delayMs = 200;

    while (retries > 0) {
      const res = await fetch(`${this.EMAIL_UI_URL}/api/v1/messages`);
      const data = (await res.json()) as {messages: Message[]};
      const email = data.messages.find((msg) =>
        msg.To.some((r) => r.Address.toLowerCase() === recipientEmail.toLowerCase()),
      );

      if (email) {
        const res = await fetch(`${this.EMAIL_UI_URL}/api/v1/message/${email.ID}`);
        const fullEmail = (await res.json()) as {Text: string};
        return fullEmail;
      }

      retries--;
      if (retries > 0) await this._sleep(delayMs);
    }
  }

  private static _extractCode(body?: string) {
    if (!body) return '';
    const SIX_DIGIT_REGEX = /(\d{6})/i;
    const pattern = new RegExp(
      `You can also manually enter the code below:?\\s*(${SIX_DIGIT_REGEX.source})`,
      'i',
    );
    const match = body.match(pattern);
    return match ? match[1] : '';
  }

  private static _extractLink(body?: string) {
    if (!body) return '';
    const linkRegex =
      /\(\s*((?:https?:\/\/)[^\s)]+\/verify-email\?email=[^&"]+&code=\d{6}&flow=onboarding[^\s)]*)\s*\)/i;
    const match = body.match(linkRegex);
    return match ? match[1] : '';
  }

  private static _sleep(ms: number = 250) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
