import {type CarryRow, pickCarryTargets} from './sync-sweep';

const row = (
	id: string,
	day: string | null,
	amount = '-15.00',
	text: string | null = null,
	currency = 'EUR',
): CarryRow => ({
	id,
	amount,
	currency,
	bookingDate: day,
	valueDate: day,
	text,
});

describe('pickCarryTargets', () => {
	it('moves edits to the same-day look-alike first, then to the fewest days apart', () => {
		const targets = pickCarryTargets(
			[row('removed', '2026-03-18')],
			[row('two-off', '2026-03-20', '-15.00', 'Example Kiosk'), row('same-day', '2026-03-18', '-15.00', 'Other')],
		);
		expect(targets).toEqual(new Map([['removed', 'same-day']]));
	});

	it('prefers the most similar text among rows as many days apart, then the lowest id', () => {
		expect(
			pickCarryTargets(
				[row('removed', '2026-03-18', '-15.00', 'Example Kiosk Station')],
				[
					row('b-plain', '2026-03-19', '-15.00', 'Example Bakery'),
					row('c-close', '2026-03-17', '-15.00', 'Example Kiosk'),
				],
			),
		).toEqual(new Map([['removed', 'c-close']]));
		expect(
			pickCarryTargets([row('removed', '2026-03-18')], [row('b', '2026-03-18'), row('a', '2026-03-18')]),
		).toEqual(new Map([['removed', 'a']]));
	});

	it('only uses rows of the same amount and currency within the match window', () => {
		const targets = pickCarryTargets(
			[row('removed', '2026-03-18')],
			[
				row('other-amount', '2026-03-18', '-15.01'),
				row('other-currency', '2026-03-18', '-15.00', null, 'USD'),
				row('too-far', '2026-03-22'),
				row('before', '2026-03-14'),
			],
		);
		expect(targets).toEqual(new Map([['removed', null]]));
	});

	it('tells amounts apart in every decimal the bank sends', () => {
		expect(
			pickCarryTargets(
				[row('removed', '2026-03-18', '-15.00100000')],
				[row('other', '2026-03-18', '-15.00400000')],
			),
		).toEqual(new Map([['removed', null]]));
	});

	it('compares amounts by value, whatever their decimals', () => {
		expect(
			pickCarryTargets([row('removed', '2026-03-18', '-15.00')], [row('target', '2026-03-21', '-15.00000000')]),
		).toEqual(new Map([['removed', 'target']]));
	});

	it('gives each target at most one carry, in the order the removed rows come', () => {
		const targets = pickCarryTargets(
			[row('first', '2026-03-18'), row('second', '2026-03-18'), row('third', '2026-03-18')],
			[row('near', '2026-03-18'), row('next', '2026-03-19')],
		);
		expect(targets).toEqual(
			new Map([
				['first', 'near'],
				['second', 'next'],
				['third', null],
			]),
		);
	});

	it('gives a look-alike to the removed row it resembles most, whichever comes first', () => {
		expect(
			pickCarryTargets(
				[
					row('corner', '2026-03-18', '-15.00', 'Example Kiosk Corner'),
					row('kiosk', '2026-03-18', '-15.00', 'Example Kiosk'),
				],
				[row('synced', '2026-03-18', '-15.00', 'Example Kiosk')],
			),
		).toEqual(
			new Map([
				['corner', null],
				['kiosk', 'synced'],
			]),
		);
	});

	it('finds no target for a row without a day', () => {
		expect(pickCarryTargets([row('removed', null)], [row('target', '2026-03-18')])).toEqual(
			new Map([['removed', null]]),
		);
	});
});
