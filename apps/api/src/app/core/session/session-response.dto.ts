export const UNKNOWN = 'Unknown';
const DEFAULT_DATE = new Date(0).toISOString();

export class SessionResponseDto {
	id: string;
	ip: string;
	deviceType: string;
	browserType: string;
	name: string;
	location: string;
	createdAt: string;
	lastSeenAt: string;
	isCurrent: boolean;

	constructor(partial: Partial<SessionResponseDto>) {
		this.id = partial.id!;
		this.ip = partial.ip ?? UNKNOWN;
		this.deviceType = partial.deviceType ?? UNKNOWN;
		this.browserType = partial.browserType ?? UNKNOWN;
		this.name = partial.name ?? UNKNOWN;
		this.location = partial.location ?? UNKNOWN;
		this.createdAt = partial.createdAt ?? DEFAULT_DATE;
		this.lastSeenAt = partial.lastSeenAt ?? DEFAULT_DATE;
		this.isCurrent = partial.isCurrent ?? false;
	}
}
