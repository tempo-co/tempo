import {Module} from '@nestjs/common';

import {BankingConsentRevocationService} from './banking-consent-revocation.service';
import {BankingEncryptionService} from './banking-encryption.service';
import {EnableBankingClient} from './enable-banking.client';

/** Leaf module so account deletion can revoke bank consents without importing BankingModule. */
@Module({
	providers: [EnableBankingClient, BankingEncryptionService, BankingConsentRevocationService],
	exports: [EnableBankingClient, BankingEncryptionService, BankingConsentRevocationService],
})
export class BankingConsentRevocationModule {}
