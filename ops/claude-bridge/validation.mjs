import contract from './contract.json' with {type: 'json'};

const categories = new Set(contract.schema.properties.classifications.items.properties.category.enum);
const nullableFields = [
	'transactionDate',
	'bookingDate',
	'valueDate',
	'creditDebitIndicator',
	'bankTransactionCode',
	'bankTransactionSubCode',
	'description',
	'counterpartyName',
	'bankTransactionDescription',
	'merchantCategoryCode',
	'remittanceInformation',
];
const requiredFields = ['correlationId', 'amount', 'currency', 'direction', 'transactionType', ...nullableFields];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.length <= 8192;
const nullableText = (value) => value === null || text(value);
const keys = (value, required, optional = []) =>
	isRecord(value) &&
	required.every((k) => Object.hasOwn(value, k)) &&
	Object.keys(value).every((k) => required.includes(k) || optional.includes(k));

const evidenceTypes = new Set(contract.webSearch.schema.properties.classifications.items.properties.evidenceType.enum);

export function validResponse(output, input, search = false) {
	if (
		!keys(output, ['classifications']) ||
		!Array.isArray(output.classifications) ||
		output.classifications.length !== input.transactions.length
	)
		return false;
	const allowedCategories = new Set(input.categories.map((c) => c.value));
	const ids = new Set(input.transactions.map((tx) => tx.correlationId));
	for (const item of output.classifications) {
		if (
			!keys(item, ['correlationId', 'category', 'confidence', ...(search ? ['evidenceType'] : [])]) ||
			(search && !evidenceTypes.has(item.evidenceType)) ||
			!ids.delete(item.correlationId) ||
			!allowedCategories.has(item.category) ||
			!Number.isFinite(item.confidence) ||
			item.confidence < 0 ||
			item.confidence > 1
		)
			return false;
	}
	return ids.size === 0;
}

const searchFields = [
	'correlationId',
	'amount',
	'currency',
	'direction',
	'transactionType',
	'merchantName',
	'merchantLocation',
	'searchQuery',
	'merchantCategoryCode',
];

export function validSearchRequest(body) {
	if (!validEnvelope(body)) return false;
	const {transactions} = body.input;
	if (!Array.isArray(transactions) || transactions.length !== 1) return false;
	const [tx] = transactions;
	return (
		keys(tx, searchFields) &&
		tx.correlationId === '0' &&
		[tx.amount, tx.currency, tx.transactionType, tx.merchantName].every(text) &&
		['INCOME', 'EXPENSE', 'UNKNOWN'].includes(tx.direction) &&
		tx.merchantName.trim() !== '' &&
		typeof tx.searchQuery === 'string' &&
		tx.searchQuery.trim() !== '' &&
		tx.searchQuery.length <= 240 &&
		nullableText(tx.merchantLocation) &&
		nullableText(tx.merchantCategoryCode)
	);
}

function validEnvelope(body) {
	if (!keys(body, ['input'], ['model']) || (Object.hasOwn(body, 'model') && body.model !== 'claude-opus-5-5'))
		return false;
	const input = body.input;
	if (!keys(input, ['categories', 'transactions'])) return false;
	if (!Array.isArray(input.categories) || !input.categories.length || input.categories.length > categories.size)
		return false;
	if (
		!input.categories.every(
			(c) =>
				keys(c, ['value', 'label', 'description']) &&
				categories.has(c.value) &&
				text(c.label) &&
				text(c.description),
		)
	)
		return false;
	return new Set(input.categories.map((c) => c.value)).size === input.categories.length;
}

export function validRequest(body) {
	if (!validEnvelope(body)) return false;
	const input = body.input;
	if (!Array.isArray(input.transactions) || !input.transactions.length || input.transactions.length > 50)
		return false;
	return input.transactions.every((tx, index) => {
		if (!keys(tx, requiredFields, ['merchantLocation', 'previousManualCategories'])) return false;
		if (tx.correlationId !== String(index) || !text(tx.amount) || !text(tx.currency) || !text(tx.transactionType))
			return false;
		if (
			!['INCOME', 'EXPENSE', 'UNKNOWN'].includes(tx.direction) ||
			!nullableFields.every((f) => nullableText(tx[f]))
		)
			return false;
		if (
			tx.merchantLocation !== undefined &&
			tx.merchantLocation !== null &&
			(!keys(tx.merchantLocation, ['city', 'region', 'country']) ||
				!Object.values(tx.merchantLocation).every(nullableText))
		)
			return false;
		if (
			tx.previousManualCategories !== undefined &&
			(!Array.isArray(tx.previousManualCategories) ||
				tx.previousManualCategories.length > categories.size ||
				!tx.previousManualCategories.every(
					(previous) =>
						keys(previous, ['category', 'count', 'recentExamples']) &&
						categories.has(previous.category) &&
						Number.isSafeInteger(previous.count) &&
						previous.count > 0 &&
						Array.isArray(previous.recentExamples) &&
						previous.recentExamples.length <= 50 &&
						previous.recentExamples.every(
							(example) =>
								keys(example, ['amount', 'date']) && text(example.amount) && nullableText(example.date),
						),
				))
		)
			return false;
		return true;
	});
}
