import type {BankImportFormat} from './imports.js';

/** A reader for a whole standard file format, as opposed to one bank's built-in CSV or XLSX layout. */
export type BankStandardFormat = Exclude<BankImportFormat, 'csv' | 'mixed'>;

/**
 * `verified`: a built-in reader reads a real export of the bank correctly, row for row (see "Verified bank" in
 * `GLOSSARY.md`). `unverified`: the bank's export menu is known, but its files go to the column mapper.
 */
export const BANK_STATUSES = ['verified', 'unverified'] as const;
export type BankStatus = (typeof BANK_STATUSES)[number];

/** How to download the file Tempo reads: short numbered steps in the bank's own menu labels, and the file to pick. */
export type BankExportSteps = {
	steps: readonly string[];
	file: string;
};

export type Bank = {
	/** Stable: stored with imports, so never renamed or reused. */
	id: string;
	name: string;
	/** ISO 3166-1 alpha-2; `null` for a bank that serves customers across countries from one app. */
	country: string | null;
	status: BankStatus;
	/** The ids of the built-in layouts that read this bank's files; empty for an unverified bank. */
	layouts: readonly string[];
	/** The standard formats verified on this bank's files; empty for an unverified bank. */
	formats: readonly BankStandardFormat[];
	exportSteps: BankExportSteps;
};

/**
 * The banks Tempo knows, verified first, then the researched unverified ones. Menu labels are quoted in the bank's
 * language with an English gloss. Each entry's sources are in `docs/bank-sources.md` of this package.
 */
export const BANK_LIST: readonly Bank[] = [
	{
		id: 'ing-nl',
		name: 'ING',
		country: 'NL',
		status: 'verified',
		layouts: ['ing-nl', 'ing-nl-11', 'ing-en-11', 'ing-en'],
		formats: ['mt940', 'camt053'],
		exportSteps: {
			steps: [
				'Log in to Mijn ING or the ING app and open your "Betaalrekening" (payment account).',
				'Search the "Af- en bijschrijvingen" (debits and credits) for the period you want.',
				'Download them as an "Afschrift" (statement) in the file type below.',
			],
			file: 'CSV, MT940 or CAMT.053',
		},
	},
	{
		id: 'rabobank',
		name: 'Rabobank',
		country: 'NL',
		status: 'verified',
		layouts: ['rabobank-nl', 'rabobank-en', 'rabobank-creditcard'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to Rabo Internetbankieren on a computer; the download is not in the Rabo app.',
				'Go to "Settings" > "Payment accounts" > "Download transactions" (with the site in English).',
				'Choose the account, the file type and the date range, then download.',
				'For a Rabobank credit card, download its CSV the same way on a computer, up to 15 months back.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'bunq',
		name: 'bunq',
		country: 'NL',
		status: 'verified',
		layouts: ['bunq-nl', 'bunq-en', 'bunq-en-7', 'bunq-en-7-semicolon'],
		formats: [],
		exportSteps: {
			steps: [
				'In the bunq app, tap your profile (top left).',
				'Select "Accounting", then "Export Statement".',
				'Choose the account, the period and CSV.',
				'Tap "Export Statement". On web.bunq.com: open the account, click the settings icon, then "Export statement".',
			],
			file: 'CSV',
		},
	},
	{
		id: 'knab',
		name: 'Knab',
		country: 'NL',
		status: 'verified',
		layouts: ['knab-nl', 'knab-nl-no-preamble'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to the "Persoonlijke Bankomgeving" (personal banking environment).',
				'Click "Betalen" (pay), then "Bij- en afschrijvingen" (debits and credits), then "Zoeken en downloaden" (search and download).',
				'Select the period and click "Downloaden" (download).',
			],
			file: 'CSV',
		},
	},
	{
		id: 'asn-bank',
		name: 'ASN Bank (also SNS and RegioBank)',
		country: 'NL',
		status: 'verified',
		layouts: ['asn-nl'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to ASN Online Bankieren or the app.',
				'Open the "Rekeningoverzicht" (account overview) and click "Bij- en afschrijvingen downloaden" (download debits and credits).',
				'Choose the period and the "Bestandsformaat" (file format), then click "Downloaden" (download).',
			],
			file: 'CSV',
		},
	},
	{
		id: 'triodos-nl',
		name: 'Triodos Bank',
		country: 'NL',
		status: 'verified',
		layouts: ['triodos-nl'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to Internet Bankieren and click "Zelf regelen" (self-service).',
				'Click "Downloads", then "Transacties exporteren" (export transactions).',
				'Select the account, the period and the file type.',
				'Click "Export aanvragen" (request export).',
				'Under "Overzicht van aangevraagde downloads van de afgelopen 2 weken" (downloads requested in the last 2 weeks), click "Download".',
			],
			file: 'CSV',
		},
	},
	{
		id: 'abn-amro',
		name: 'ABN AMRO',
		country: 'NL',
		status: 'verified',
		layouts: [],
		formats: ['abnAmroTxt', 'camt053'],
		exportSteps: {
			steps: [
				'Log in to ABN AMRO Internet Banking and open "Bij- en afschrijvingen downloaden" (download debits and credits).',
				'Choose the account, the period (up to 18 months back) and the file type, then download.',
			],
			file: 'TXT or CAMT.053 (not XLS)',
		},
	},
	{
		id: 'handelsbanken-nl',
		name: 'Handelsbanken',
		country: 'NL',
		status: 'verified',
		layouts: [],
		formats: ['mt940', 'camt053'],
		exportSteps: {
			steps: [
				'In Handelsbanken internet banking, export your transactions (up to 12 months back) in the file type below.',
			],
			file: 'MT940 or CAMT.053',
		},
	},
	{
		id: 'revolut',
		name: 'Revolut',
		country: null,
		status: 'verified',
		layouts: [],
		formats: ['revolutCsv', 'revolutXlsx'],
		exportSteps: {
			steps: [
				'In the Revolut app, tap "Home", then "Accounts", and choose the currency.',
				'Tap "More (...)", then "Statement".',
				'Choose the timeframe and Excel, then download.',
			],
			file: 'Excel',
		},
	},
	{
		id: 'banque-populaire',
		name: 'Banque Populaire',
		country: 'FR',
		status: 'verified',
		layouts: [],
		formats: ['ofx'],
		exportSteps: {
			steps: [
				'On the account summary, click "Gérer" (manage), then in the account\'s menu "Télécharger les opérations" (download transactions).',
				'Choose the format, the period and the field separator ";".',
				'If "Gérer" is missing: click your name (top right) > "Autres réglages" (other settings), turn on "Fonctionnalités avancées" (advanced features), then start again.',
			],
			file: 'Money (.ofx)',
		},
	},
	{
		id: 'caisse-epargne',
		name: "Caisse d'Épargne",
		country: 'FR',
		status: 'verified',
		layouts: [],
		formats: ['ofx'],
		exportSteps: {
			steps: [
				'On the account summary, click "Gérer" (manage), then in the account\'s menu "Télécharger les opérations" (download transactions).',
				'Choose the format, the period and the field separator ";".',
				'If "Gérer" is missing: click your name (top right) > "Autres réglages" (other settings), turn on "Fonctionnalités avancées" (advanced features), then start again.',
			],
			file: 'Money (.ofx)',
		},
	},
	{
		id: 'credit-agricole-fr',
		name: 'Crédit Agricole',
		country: 'FR',
		status: 'verified',
		layouts: [],
		formats: ['ofx'],
		exportSteps: {
			steps: ["In your Crédit Agricole customer area, download your account's transactions as OFX."],
			file: 'OFX',
		},
	},
	{
		id: 'la-banque-postale',
		name: 'La Banque Postale',
		country: 'FR',
		status: 'verified',
		layouts: [],
		formats: ['ofx'],
		exportSteps: {
			steps: [
				'In the Espace Client Internet, click "Télécharger le détail" (download the details) in the navigation bar.',
				'Click "Confirmer" (confirm) and check the account shown.',
				'Choose "format OFX".',
				'Click "Confirmer" again to download.',
			],
			file: 'format OFX',
		},
	},
	{
		id: 'lcl',
		name: 'LCL',
		country: 'FR',
		status: 'verified',
		layouts: [],
		formats: ['ofx'],
		exportSteps: {
			steps: ["In your LCL customer area, download your account's transactions as OFX."],
			file: 'OFX',
		},
	},
	{
		id: 'cic',
		name: 'CIC',
		country: 'FR',
		status: 'verified',
		layouts: [],
		formats: ['ofx'],
		exportSteps: {
			steps: ["In your CIC customer area, download your account's transactions as OFX."],
			file: 'OFX',
		},
	},
	{
		id: 'gls-bank',
		name: 'GLS Bank',
		country: 'DE',
		status: 'verified',
		layouts: [],
		formats: ['camt053'],
		exportSteps: {
			steps: [
				'Log in to GLS Onlinebanking.',
				'Click "Banking&Verträge" (banking and contracts), then "Start".',
				'Select the account and open "Umsätze" (transactions).',
				'Click the arrow icon ("Pfeil").',
				'Choose the file type and the period, up to 24 months back. A TAN may be needed for more than 90 days.',
			],
			file: 'CAMT; GLS Bank turns it on for your account when you ask in the "Postfach" (mailbox)',
		},
	},
	{
		id: 'postbank',
		name: 'Postbank',
		country: 'DE',
		status: 'verified',
		layouts: [],
		formats: ['mt940'],
		exportSteps: {
			steps: [
				'Log in to online banking with your access data and BestSign.',
				'Select the account in the financial overview.',
				'Click "Filtern" (filter), set "Von" and "Bis" (from and to), then click "Anwenden" (apply).',
				'Download the filtered transactions in the file type below.',
			],
			file: 'MT940',
		},
	},
	{
		id: 'boursobank',
		name: 'BoursoBank',
		country: 'FR',
		status: 'unverified',
		layouts: [],
		formats: [],
		exportSteps: {
			steps: [
				'Click the account.',
				'Choose the period and click "Rechercher" (search).',
				'Below the results, click "Exporter en Format CSV" (export in CSV format).',
			],
			file: 'CSV',
		},
	},
	{
		id: 'societe-generale',
		name: 'Société Générale',
		country: 'FR',
		status: 'unverified',
		layouts: [],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to your Espace Client.',
				'Open "Téléchargement" (download) and choose "Relevé de compte CSV" (account statement, CSV).',
			],
			file: 'CSV',
		},
	},
	{
		id: 'santander-es',
		name: 'Santander',
		country: 'ES',
		status: 'unverified',
		layouts: [],
		formats: [],
		exportSteps: {
			steps: [
				'Enter "Acceso clientes" (customer login) with your ID document and access key.',
				'Select the account.',
				'Filter with the magnifier ("lupa") for the period you want, up to two years back.',
				'Click the vertical-arrow icon and download as Excel. In the app: "Posición Global" (global position) > the account > "Filtros" (filters) > "Descargar" (download).',
			],
			file: 'Excel (.xlsx; an old .xls file is not read)',
		},
	},
	{
		id: 'ing-slaski',
		name: 'ING Bank Śląski',
		country: 'PL',
		status: 'unverified',
		layouts: [],
		formats: [],
		exportSteps: {
			steps: [
				"Open the account's transaction list.",
				'Click the download icon at the top right of the list and choose CSV, up to 12 months back.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'pekao',
		name: 'Pekao',
		country: 'PL',
		status: 'unverified',
		layouts: [],
		formats: [],
		exportSteps: {
			steps: [
				'Open the "LISTA OPERACJI" (operations list) of the account or credit card.',
				'Use the download-and-save option for the history and choose CSV. One file holds at most 1,500 transactions.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'bank-of-ireland',
		name: 'Bank of Ireland',
		country: 'IE',
		status: 'unverified',
		layouts: [],
		formats: [],
		exportSteps: {
			steps: [
				'Open "365 online" on the web (the mobile apps cannot export) and choose the account.',
				'Click "Export your transaction history", up to 12 months back.',
				'Complete the on-screen prompts. Credit card transactions cannot be exported.',
			],
			file: 'CSV',
		},
	},
];

/** What to look for at a bank the list does not name. */
export const OTHER_BANK_EXPORT_TEXT =
	'Look first for a download named CAMT (camt.053), MT940 or OFX: Tempo reads those most reliably. If your bank offers only CSV or Excel, choose CSV, or Excel saved as .xlsx; old .xls files are not read. Never choose PDF. In the website or app, open your account, then its transaction list, set the widest date range the bank allows, and look for a Download or Export button, usually above the list. If you cannot find one, search the help section for "export" or "download transactions".';
