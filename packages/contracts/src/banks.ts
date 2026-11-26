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
				'Log in to Mijn ING on a computer.',
				'Click "Service", then "Overzichten en downloads" (overviews and downloads), then "Af- en bijschrijvingen downloaden" (download debits and credits).',
				'Select the account and the period.',
				'Choose a CSV "Bestandsformaat" (file format), not PDF, and click "Downloaden" (download).',
				'In the ING app: open the payment account, tap "Instellingen" (the gear), then "Afschriften downloaden" (download statements).',
			],
			file: 'CSV',
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
				'Log in to Rabo Online Bankieren.',
				'Open "Maak een transactieoverzicht op maat" (make a custom transaction overview); in English, "Settings" > "Payment accounts" > "Download transactions".',
				'Choose the account, the "Downloadformaat" (download format) and a "Specifieke datumreeks" (specific date range), then download.',
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
				'In "Internet Bankieren", open "Bij- en afschrijvingen downloaden" (download debits and credits).',
				'Choose the "Rekeninghouder" (account holder) and the "Bestandsformaat" (file format): camt.053 or txt.',
				'Choose a start and end date (up to 18 months back).',
				'Click the download symbol to the left of the account, and save the file.',
				'In the ABN AMRO app: "Profiel" > "Rekeningen en betalen" > "Afschriften en jaaroverzicht", then "Soort overzicht" (kind of overview): "Bij- en afschrijvingen".',
			],
			file: 'CAMT.053 or TXT (not XLS)',
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
				'In the Revolut app, tap "Home" and choose the currency account.',
				'Tap "More (...)", then "Statement".',
				'Choose the timeframe and Excel, then tap "Generate".',
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
		layouts: ['la-banque-postale-fr'],
		formats: ['ofx'],
		exportSteps: {
			steps: [
				'In the Espace Client Internet, click "Télécharger le détail" (download the details) in the navigation bar.',
				'Click "Confirmer" (confirm) and check the account shown.',
				'Choose "format OFX", or "tableur CSV" (spreadsheet CSV).',
				'Click "Confirmer" again to download.',
			],
			file: 'format OFX or tableur CSV',
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
			steps: [
				'Open the "Comptes" (accounts) tab, then "Synthèse" (summary).',
				'Select the "date de début" (start date) and "date de fin" (end date).',
				'Select OFX as the "format de fichier" (file format).',
				'Click "Valider" (confirm) to download.',
			],
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
		layouts: ['atruvia'],
		formats: ['camt053'],
		exportSteps: {
			steps: [
				'Log in to GLS Onlinebanking.',
				'Click "Banking&Verträge" (banking and contracts), then "Start".',
				'Select the account and open "Umsätze" (transactions).',
				'Click the arrow icon ("Pfeil").',
				'Choose the file type and the period, up to 24 months back. A TAN may be needed for more than 90 days.',
			],
			file: 'CSV, or CAMT once GLS Bank turns it on for your account when you ask in the "Postfach" (mailbox)',
		},
	},
	{
		id: 'sparkasse',
		name: 'Sparkasse',
		country: 'DE',
		status: 'verified',
		layouts: ['sparkasse-camt-v2', 'sparkasse-mt940', 'sparkasse-creditcard'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to online banking with your "Anmeldename" (login name) and PIN.',
				'In the "Finanzstatus" (financial status), choose the account\'s "Umsatzabfrage" (transaction search).',
				'Choose the period and export the transactions in the file type below.',
			],
			file: 'CSV-CAMT V2 (or CSV-MT940)',
		},
	},
	{
		id: 'volksbanken-raiffeisenbanken',
		name: 'Volksbanken Raiffeisenbanken',
		country: 'DE',
		status: 'verified',
		layouts: ['atruvia'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to OnlineBanking with your VR-NetKey and PIN.',
				"Open the account's transactions.",
				'Click the three grey dots, choose "Export", then CSV.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'ing-de',
		name: 'ING',
		country: 'DE',
		status: 'verified',
		layouts: ['ing-de', 'ing-de-saldo'],
		formats: [],
		exportSteps: {
			steps: [
				'Open the "Umsatzanzeige" (transaction view) of the account and set the filters you want, up to 390 days back.',
				'Scroll to the bottom and click "Exportieren" (export).',
			],
			file: 'CSV',
		},
	},
	{
		id: 'deutsche-bank',
		name: 'Deutsche Bank',
		country: 'DE',
		status: 'verified',
		layouts: ['deutsche-bank-19', 'deutsche-bank-6', 'deutsche-bank-planer'],
		formats: [],
		exportSteps: {
			steps: [
				'Open "Finanzübersicht" (financial overview), then "Produkte" (products), then the account.',
				'At the bottom of the "Umsatzliste" (transaction list), click "Herunterladen" (download) and choose "CSV-Datei" (CSV file).',
			],
			file: 'CSV-Datei (not the Excel document)',
		},
	},
	{
		id: 'postbank',
		name: 'Postbank',
		country: 'DE',
		status: 'verified',
		layouts: ['postbank'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to online banking with your access data and BestSign.',
				'Select the account in the "Finanzübersicht" (financial overview).',
				'Click "Filtern" (filter), set "Von" and "Bis" (from and to), then click "Anwenden" (apply).',
				'Download the filtered transactions as CSV.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'commerzbank',
		name: 'Commerzbank',
		country: 'DE',
		status: 'verified',
		layouts: ['commerzbank-8', 'commerzbank-9'],
		formats: [],
		exportSteps: {
			steps: [
				"Log in to online banking in a browser (the app cannot export) and open the account's transaction overview.",
				'Click "PDF/CSV" above the list on the right, then "Umsätze exportieren" (export transactions). Optionally tick entries or set filters.',
				'Choose "CSV" and click "Exportieren" (export).',
			],
			file: 'CSV',
		},
	},
	{
		id: 'dkb',
		name: 'DKB',
		country: 'DE',
		status: 'verified',
		layouts: ['dkb'],
		formats: [],
		exportSteps: {
			steps: [
				'Open the "Umsatzübersicht" (transaction overview) and set the filters you want: the export holds the filtered list.',
				'Click "Exportieren" (export) and choose CSV.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'n26',
		name: 'N26',
		country: null,
		status: 'verified',
		layouts: ['n26-de', 'n26-en'],
		formats: [],
		exportSteps: {
			steps: [
				'On the N26 website (the app offers only PDF statements), go to the Home tab, select the account or Space and open "Downloads".',
				'Under "Account Activity", enter the start and end dates.',
				'Choose "CSV", then click "Download".',
			],
			file: 'CSV',
		},
	},
	{
		id: 'comdirect',
		name: 'comdirect',
		country: 'DE',
		status: 'verified',
		layouts: ['comdirect'],
		formats: [],
		exportSteps: {
			steps: [
				'Open "Konto & Karte", then "Umsätze" (transactions), up to about 540 days back.',
				'Apply the filter you want, then click "Export als csv" (export as CSV) at the bottom.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'targobank',
		name: 'Targobank',
		country: 'DE',
		status: 'verified',
		layouts: ['targobank'],
		formats: [],
		exportSteps: {
			steps: [
				'Click "Konten" (accounts), then "Übersicht" (overview), then "Download der Umsätze" (download transactions).',
			],
			file: 'CSV (an Excel file is not read)',
		},
	},
	{
		id: 'sparda-bank',
		name: 'Sparda-Bank',
		country: 'DE',
		status: 'verified',
		layouts: ['sparda-bank'],
		formats: [],
		exportSteps: {
			steps: [
				"In online banking, open the account's transaction list and download it as CSV. Downloads may reach back only 30 days.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'vivid-money',
		name: 'Vivid Money',
		country: null,
		status: 'verified',
		layouts: ['vivid'],
		formats: [],
		exportSteps: {
			steps: ['In the Vivid app, open the "Transactions" tab and tap the export button at the top right.'],
			file: 'CSV',
		},
	},
	{
		id: 'intesa-sanpaolo',
		name: 'Intesa Sanpaolo',
		country: 'IT',
		status: 'verified',
		layouts: ['intesa-sanpaolo-it'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to internet banking or the app and open the account movements ("movimenti").',
				'Filter the movements if you want only some of them.',
				'Click "Scarica PDF / Excel" (download PDF or Excel) and choose Excel.',
			],
			file: 'Excel',
		},
	},
	{
		id: 'unicredit-it',
		name: 'UniCredit',
		country: 'IT',
		status: 'verified',
		layouts: ['unicredit-it', 'unicredit-it-two-line-header', 'unicredit-it-balances'],
		formats: [],
		exportSteps: {
			steps: [
				'On the UniCredit website, click "Accesso area clienti" (customer area login).',
				'Enter your enrolment code and PIN, and approve in the app if asked.',
				'Click "I miei conti" (my accounts) in the left sidebar and select the account.',
				'Click "Scarica" (download) beside the latest movements.',
				'Choose "EXPORT CSV". The app cannot export the list.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'finecobank',
		name: 'FinecoBank',
		country: 'IT',
		status: 'verified',
		layouts: ['fineco-it', 'fineco-it-value-date', 'fineco-it-xlsx'],
		formats: [],
		exportSteps: {
			steps: [
				"Log in to Fineco on the web and open your current account's movements.",
				'Use the filter to choose the period, up to 4 years back.',
				"Download the movements as a file. Fineco's help does not describe the download.",
			],
			file: 'CSV or Excel (.xlsx)',
		},
	},
	{
		id: 'credit-agricole-it',
		name: 'Crédit Agricole Italia',
		country: 'IT',
		status: 'verified',
		layouts: ['credit-agricole-it'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to online banking and open the account movements.',
				"Choose the period and download the movements as a file. The bank's help does not describe the download.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'popolare-sondrio',
		name: 'Banca Popolare di Sondrio',
		country: 'IT',
		status: 'verified',
		layouts: ['popolare-sondrio-it'],
		formats: [],
		exportSteps: {
			steps: [
				"Banca Popolare di Sondrio's online services moved to BPER's digital services in April 2026: log in there.",
				'Open the account movements and choose the period.',
				"Download the movements as a file. Neither bank's help describes the download.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'raiffeisen-at',
		name: 'Raiffeisen',
		country: 'AT',
		status: 'verified',
		layouts: ['raiffeisen-at-elba'],
		formats: [],
		exportSteps: {
			steps: [
				'In Mein ELBA, open "Kontostand & Umsätze" (balance and transactions), then "Umsätze" (transactions).',
				'Use "Umsätze suchen und Umsatzübersicht exportieren" (search transactions and export the overview) to filter the period.',
				'Download the list as CSV.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'ing-at',
		name: 'ING',
		country: 'AT',
		status: 'verified',
		layouts: ['ing-at'],
		formats: [],
		exportSteps: {
			steps: [
				"Log in to ING online banking on the web and open the account's transactions.",
				"Choose the period and download the transactions as CSV. ING's help does not describe the download.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'oberbank',
		name: 'Oberbank',
		country: 'AT',
		status: 'verified',
		layouts: ['oberbank-at'],
		formats: [],
		exportSteps: {
			steps: [
				"Log in to the Oberbank customer portal and open the account's transactions.",
				"Export them as CSV. Oberbank's help describes the export for business customers only.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'easybank',
		name: 'easybank',
		country: 'AT',
		status: 'verified',
		layouts: ['easybank-at', 'easybank-at-creditcard'],
		formats: [],
		exportSteps: {
			steps: [
				'In easy eBanking, go to "Finanzübersicht" (financial overview).',
				'Open "Umsatzanzeige" (transaction view) and search or filter the period.',
				'Export as CSV. The file holds every transaction the search finds, not only those on screen.',
				"Tempo also reads an easybank credit card's CSV file; easybank's help does not describe its download.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'kbc',
		name: 'KBC',
		country: 'BE',
		status: 'verified',
		layouts: ['kbc-be', 'kbc-be-creditcard'],
		formats: [],
		exportSteps: {
			steps: [
				'In KBC Touch, go to "Betalen" (payments), then "Zoeken en Rapporten" (search and reports).',
				"Search the account's transactions for the period you want.",
				'Click "Downloaden" (download) and choose CSV, not PDF.',
				"Tempo also reads a KBC credit card's CSV file; KBC's pages do not describe its download.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'belfius',
		name: 'Belfius',
		country: 'BE',
		status: 'verified',
		layouts: ['belfius-be'],
		formats: [],
		exportSteps: {
			steps: [
				'In Belfius Direct Net, choose the account and, if you like, search criteria to narrow the dates.',
				'Click "Exporteren" (export) below the transaction table.',
				'Choose CSV, then click "Exporteren" again.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'ing-be',
		name: 'ING',
		country: 'BE',
		status: 'verified',
		layouts: ['ing-be'],
		formats: [],
		exportSteps: {
			steps: [
				"Log in to ING Home'Bank on a computer and open the account's transactions.",
				"Choose the period and download the transactions as CSV. ING Belgium's help does not describe the download.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'bnp-paribas-fortis',
		name: 'BNP Paribas Fortis',
		country: 'BE',
		status: 'verified',
		layouts: ['bnp-paribas-fortis-be'],
		formats: [],
		exportSteps: {
			steps: [
				"Log in to BNP Paribas Fortis online banking on a computer and open the account's transactions.",
				"Download the transactions as CSV. BNP Paribas Fortis's help describes downloads for business customers only.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'mbank',
		name: 'mBank',
		country: 'PL',
		status: 'verified',
		layouts: ['mbank-pl'],
		formats: [],
		exportSteps: {
			steps: [
				'Open the account\'s transaction history ("Historia operacji").',
				'Select the transactions you want, or leave all selected.',
				'Click "Eksportuj listę" (export list) and choose CSV.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'aib',
		name: 'AIB',
		country: 'IE',
		status: 'verified',
		layouts: ['aib-ie'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to AIB Internet Banking.',
				'Open the historical transactions search and choose the period, up to two years back.',
				'Click "Export" on the results page and save the CSV file.',
			],
			file: 'CSV',
		},
	},
	{
		id: 'nordea-se',
		name: 'Nordea',
		country: 'SE',
		status: 'verified',
		layouts: ['nordea-se'],
		formats: [],
		exportSteps: {
			steps: [
				'Log in to the netbank ("nätbanken") on the web; the app cannot export.',
				'Open the account and choose the period ("datumperiod").',
				'Click "CSV (Excel)".',
			],
			file: 'CSV',
		},
	},
	{
		id: 'handelsbanken-se',
		name: 'Handelsbanken',
		country: 'SE',
		status: 'verified',
		layouts: ['handelsbanken-se'],
		formats: [],
		exportSteps: {
			steps: [
				"In Handelsbanken's internet bank on a computer, open the account's transactions and choose the period.",
				"Export them as Excel (.xlsx). Handelsbanken's help does not describe the export.",
			],
			file: 'Excel (.xlsx)',
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
		id: 'pko-bp',
		name: 'PKO Bank Polski',
		country: 'PL',
		status: 'unverified',
		layouts: [],
		formats: [],
		exportSteps: {
			steps: [
				"In iPKO, open the account's transaction history and choose the period, up to 12 months.",
				"Download it as CSV. PKO's pages for private customers do not describe the download.",
			],
			file: 'CSV',
		},
	},
	{
		id: 'santander-pl',
		name: 'Santander Bank Polska',
		country: 'PL',
		status: 'unverified',
		layouts: [],
		formats: [],
		exportSteps: {
			steps: [
				"In Santander internet banking, open the account's transactions.",
				"Export them as CSV, up to three months at a time. Santander's pages do not describe the export.",
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

/** The pick for a bank the list does not name ("Another bank"); no bank in `BANK_LIST` takes this id. */
export const OTHER_BANK_ID = 'other';

/**
 * The bank a user picked before importing, sent as the optional multipart text field `bankId` of
 * `POST /bank-imports` and `POST /bank-imports/layout-proposals`: a `BANK_LIST` id or `OTHER_BANK_ID`. Any other value
 * is refused (400). The import records it, and a layout confirmed from the proposal keeps it.
 */
export type BankImportPickedBank = {bankId?: string};

/** Whether `id` is a bank the user may pick: one in `BANK_LIST`, or `OTHER_BANK_ID`. */
export function isPickableBankId(id: string): boolean {
	return id === OTHER_BANK_ID || BANK_LIST.some((bank) => bank.id === id);
}

/** The kinds of file a bank may offer, as a "Tell us your bank" request names them. */
export const BANK_REQUEST_FILE_TYPES = ['csv', 'excel', 'camt', 'mt940', 'ofx', 'qif', 'pdf', 'other'] as const;
export type BankRequestFileType = (typeof BANK_REQUEST_FILE_TYPES)[number];

/** The longest bank name a request may carry. */
export const BANK_REQUEST_MAX_NAME_LENGTH = 60;
/** The requests one user may send in 24 hours; more are refused with 429. */
export const BANK_REQUEST_MAX_PER_DAY = 5;

/**
 * `POST /bank-imports/bank-requests` (204, no body): asks Tempo to read a bank's files. No file is sent and no reply
 * follows. The name is kept as plain text, never read as instructions.
 */
export type CreateBankRequest = {
	/** 1 to `BANK_REQUEST_MAX_NAME_LENGTH` characters once trimmed. */
	bankName: string;
	/** ISO 3166-1 alpha-2, upper case. */
	country: string;
	/** At least one, each once. */
	fileTypes: BankRequestFileType[];
};
