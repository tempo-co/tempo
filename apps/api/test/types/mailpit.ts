export type MailpitResponse = {
	/** Messages */
	messages: {
		/** The number of attachments */
		Attachments: number;
		/** BCC addresses */
		Bcc: MailpitEmailAddressResponse[];
		/** CC addresses */
		Cc: MailpitEmailAddressResponse[];
		/** Created time in ISO format: 1970-01-01T00:00:00.000Z */
		Created: string;
		/** Sender address */
		From: MailpitEmailAddressResponse;
		/** Database ID */
		ID: string;
		/** Message ID */
		MessageID: string;
		/** Read status */
		Read: boolean;
		/** Reply-To addresses */
		ReplyTo: MailpitEmailAddressResponse[];
		/** Message size in bytes (total) */
		Size: number;
		/** Message snippet includes up to 250 characters */
		Snippet: string;
		/** Email subject */
		Subject: string;
		/** Message tags */
		Tags: string[];
		/** To addresses */
		To: MailpitEmailAddressResponse[];
	}[];
	/** Total number of messages matching the current query */
	messages_count: number;
	/** Total number of unread messages matching current query */
	messages_unread: number;
	/** Pagination offset */
	start: number;
	/** All current tags */
	tags: string[];
	/** Total number of messages in mailbox */
	total: number;
	/** Total number of unread messages in mailbox */
	unread: number;
};

/** Represents a name and email address from a response. */
type MailpitEmailAddressResponse = {
	/** Email address */
	Address: string;
	/** Name associated with the email address */
	Name: string;
};

export type MailpitMessageSummaryResponse = {
	/** Message Attachmets */
	Attachments: MailpitAttachmentResponse[];
	/** BCC addresses */
	Bcc: MailpitEmailAddressResponse[];
	/** CC addresses */
	Cc: MailpitEmailAddressResponse[];
	/** Message date if set, else date received. In ISO format: 1970-01-01T00:00:00.000Z */
	Date: string;
	/** sender address */
	From: MailpitEmailAddressResponse;
	/** Message body HTML */
	HTML: string;
	/** Database ID */
	ID: string;
	/** Inline message attachements */
	Inline: MailpitEmailAddressResponse[];
	/** ListUnsubscribe contains a summary of List-Unsubscribe & List-Unsubscribe-Post headers including validation of the link structure */
	ListUnsubscribe: {
		/** Validation errors (if any) */
		Errors: string;
		/** List-Unsubscrobe header value */
		Header: string;
		/** List-Unsubscribe-Post valie (if set) */
		HeaderPost: string;
		/** Detected links, maximum one email and one HTTP(S) link  */
		Links: string[];
	};
	/** Message ID */
	MessageID: string;
	/** ReplyTo addresses */
	ReplyTo: MailpitEmailAddressResponse[];
	/** Return-Path */
	ReturnPath: string;
	/** Message size in bytes */
	Size: number;
	/** Message subject */
	Subject: string;
	/** Messages tags */
	Tags: string[];
	/** Message body text */
	Text: string;
	/** To addresses */
	To: MailpitEmailAddressResponse[];
};

/** Represents an attachment from a response. */
type MailpitAttachmentResponse = {
	/** Content ID */
	ContentID: string;
	/** Content type */
	ContentType: string;
	/** File name */
	FileName: string;
	/** Attachment part ID */
	PartID: string;
	/** Size in bytes */
	Size: number;
};
