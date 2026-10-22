import {Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';

import {
	FETCH_MERCHANT_LOGO_JOB,
	IDENTIFY_MERCHANTS_JOB,
	MERCHANT_LOGO_QUEUE,
	RECONCILE_MERCHANT_LOGOS_JOB,
} from '@core/queue/queue.constants';

import {
	FetchMerchantLogoJobData,
	IdentifyMerchantsJobData,
	MerchantLogoJobData,
	MerchantLogoService,
} from './merchant-logo.service';

@Processor(MERCHANT_LOGO_QUEUE, {concurrency: 1})
export class MerchantLogoProcessor extends WorkerHost {
	constructor(private readonly merchantLogoService: MerchantLogoService) {
		super();
	}

	async process(job: Job<MerchantLogoJobData>): Promise<void> {
		switch (job.name) {
			case IDENTIFY_MERCHANTS_JOB:
				await this.merchantLogoService.identifyMerchants((job.data as IdentifyMerchantsJobData).merchantIds);
				return;
			case FETCH_MERCHANT_LOGO_JOB:
				await this.merchantLogoService.fetchLogo((job.data as FetchMerchantLogoJobData).logoId);
				return;
			case RECONCILE_MERCHANT_LOGOS_JOB:
				await this.merchantLogoService.reconcile();
				return;
		}
	}
}
