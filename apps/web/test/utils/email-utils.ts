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

  static async findEmailByRecipient(
    recipientEmail: string,
    retries: number = 10,
    delayMs: number = 200,
  ) {
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

  static async countEmailsByRecipient(recipientEmail: string, initialDelayMs: number = 1000) {
    await this._sleep(initialDelayMs);

    const res = await fetch(`${this.EMAIL_UI_URL}/api/v1/messages`);
    const data = (await res.json()) as {messages: Message[]};

    const count = data.messages.filter((msg) =>
      msg.To.some((r) => r.Address && r.Address.toLowerCase() === recipientEmail.toLowerCase()),
    ).length;
    return count;
  }

  static extractVerifyEmailLink(body?: string) {
    if (!body) return '';
    const linkRegex =
      /\(\s*((?:https?:\/\/)[^\s)]+\/verify-email\?email=[^&"]+&code=\d{6}&flow=onboarding[^\s)]*)\s*\)/i;
    const match = body.match(linkRegex);
    return match ? match[1] : '';
  }

  static extractResetPasswordLink(body?: string) {
    if (!body) return '';

    const linkRegex =
      /(https?:\/\/[^\s"'<>]*\/reset-password\?email=[^&"\s<>]+&token=[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}[^\s"'<>]*)/i;
    const match = body.match(linkRegex);
    return match ? match[1] : '';
  }

  static extractCode(body?: string) {
    if (!body) return '';
    const SIX_DIGIT_REGEX = /(\d{6})/i;
    const pattern = new RegExp(
      `You can also manually enter the code below:?\\s*(${SIX_DIGIT_REGEX.source})`,
      'i',
    );
    const match = body.match(pattern);
    return match ? match[1] : '';
  }

  private static _sleep(ms: number = 250) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
