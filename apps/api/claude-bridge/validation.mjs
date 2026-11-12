import contract from './contract.json' with {type: 'json'};
import merchantContract from './merchant-contract.json' with {type: 'json'};

const categories = new Set(contract.schema.properties.classifications.items.properties.category.enum);
const directions = ['INCOME', 'EXPENSE', 'UNKNOWN'];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.length <= 8192;
const nullableText = (value) => value === null || text(value);
const keys = (value, required, optional = []) =>
	isRecord(value) &&
	required.every((k) => Object.hasOwn(value, k)) &&
	Object.keys(value).every((k) => required.includes(k) || optional.includes(k));

const types = {
	string: (value) => typeof value === 'string',
	number: Number.isFinite,
	integer: Number.isInteger,
	boolean: (value) => typeof value === 'boolean',
	null: (value) => value === null,
	object: isRecord,
	array: Array.isArray,
};
// A keyword this checker does not know would otherwise be ignored, so the bridge refuses to start on one.
const keywords = new Set([
	'$schema',
	'type',
	'enum',
	'anyOf',
	'minLength',
	'maxLength',
	'pattern',
	'exclusiveMinimum',
	'minimum',
	'maximum',
	'properties',
	'required',
	'additionalProperties',
	'items',
	'minItems',
	'maxItems',
]);

/** Throws unless every keyword in `schema` is one {@link matchesSchema} checks. */
export function assertSupportedSchema(schema) {
	for (const [keyword, value] of Object.entries(schema)) {
		if (!keywords.has(keyword) || (keyword === 'type' && !Object.hasOwn(types, value)))
			throw new Error(`Unsupported input schema keyword: ${keyword}`);
		if (keyword === 'additionalProperties' && value !== false)
			throw new Error('Input schema objects must not allow additional properties.');
		if (keyword === 'properties') Object.values(value).forEach(assertSupportedSchema);
		if (keyword === 'items') assertSupportedSchema(value);
		if (keyword === 'anyOf') value.forEach(assertSupportedSchema);
	}
}

/**
 * Checks `value` against the JSON Schema the API generates from its zod input schema (`input` in `contract.json`). It
 * implements the keywords that generator emits; lengths count UTF-16 code units, as zod does.
 */
export function matchesSchema(schema, value) {
	if (schema.type !== undefined && !types[schema.type](value)) return false;
	if (schema.enum && !schema.enum.includes(value)) return false;
	if (schema.anyOf && !schema.anyOf.some((option) => matchesSchema(option, value))) return false;
	if (typeof value === 'string') {
		if (schema.minLength !== undefined && value.length < schema.minLength) return false;
		if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
		if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return false;
	}
	if (typeof value === 'number') {
		if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
		if (schema.minimum !== undefined && value < schema.minimum) return false;
		if (schema.maximum !== undefined && value > schema.maximum) return false;
	}
	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) return false;
		if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
		if (schema.items && !value.every((item) => matchesSchema(schema.items, item))) return false;
	}
	if (isRecord(value) && schema.properties) {
		const properties = Object.keys(schema.properties);
		if (!keys(value, schema.required ?? [], properties)) return false;
		if (!Object.entries(value).every(([key, field]) => matchesSchema(schema.properties[key], field))) return false;
	}
	return true;
}

const transactionSchema = contract.input.transaction;
const searchTransactionSchema = contract.webSearch.input.transaction;
assertSupportedSchema(transactionSchema);
assertSupportedSchema(searchTransactionSchema);

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

export function validSearchRequest(body) {
	if (!validEnvelope(body)) return false;
	const {transactions} = body.input;
	if (!Array.isArray(transactions) || transactions.length !== 1) return false;
	const [tx] = transactions;
	return matchesSchema(searchTransactionSchema, tx) && tx.correlationId === '0';
}

function validEnvelope(body) {
	if (
		!keys(body, ['model', 'effort', 'input']) ||
		!contract.models.includes(body.model) ||
		!contract.efforts.includes(body.effort)
	)
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
	const {transactions} = body.input;
	if (!Array.isArray(transactions) || !transactions.length || transactions.length > contract.input.maxTransactions)
		return false;
	return transactions.every((tx, index) => matchesSchema(transactionSchema, tx) && tx.correlationId === String(index));
}

const merchantFields = ['correlationId', 'name', 'location', 'transactionType', 'direction', 'searchSourceDomains'];
const merchantKinds = new Set(merchantContract.schema.properties.merchants.items.properties.kind.enum);
const hostname = (value) =>
	typeof value === 'string' && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);

export function validMerchantRequest(body) {
	if (
		!keys(body, ['model', 'effort', 'input']) ||
		!contract.models.includes(body.model) ||
		!contract.efforts.includes(body.effort)
	)
		return false;
	const {merchants} = body.input ?? {};
	if (
		!keys(body.input, ['merchants']) ||
		!Array.isArray(merchants) ||
		!merchants.length ||
		merchants.length > merchantContract.maxMerchants
	)
		return false;
	return merchants.every(
		(merchant, index) =>
			keys(merchant, merchantFields) &&
			merchant.correlationId === String(index) &&
			typeof merchant.name === 'string' &&
			merchant.name.trim() !== '' &&
			merchant.name.length <= merchantContract.maxNameLength &&
			nullableText(merchant.location) &&
			text(merchant.transactionType) &&
			directions.includes(merchant.direction) &&
			Array.isArray(merchant.searchSourceDomains) &&
			merchant.searchSourceDomains.length <= merchantContract.maxSourceDomains &&
			merchant.searchSourceDomains.every(hostname),
	);
}

export function validMerchantResponse(output, input) {
	if (
		!keys(output, ['merchants']) ||
		!Array.isArray(output.merchants) ||
		output.merchants.length !== input.merchants.length
	)
		return false;
	const ids = new Set(input.merchants.map((merchant) => merchant.correlationId));
	return (
		output.merchants.every(
			(item) =>
				keys(item, ['correlationId', 'kind', 'brand', 'domain', 'domainConfident']) &&
				ids.delete(item.correlationId) &&
				merchantKinds.has(item.kind) &&
				nullableText(item.brand) &&
				nullableText(item.domain) &&
				typeof item.domainConfident === 'boolean',
		) && ids.size === 0
	);
}
