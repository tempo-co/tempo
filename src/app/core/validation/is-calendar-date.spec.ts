import {IsOptional, validateSync} from 'class-validator';
import 'reflect-metadata';

import {BankTransactionBookingDateFilterDto} from '@modules/banking/api/dtos/bank-transaction-query.dto';
import {BankTransactionSummaryQueryDto} from '@modules/banking/api/dtos/bank-transaction-summary-query.dto';

import {IsCalendarDate} from './is-calendar-date';

class CalendarDateDto {
	@IsCalendarDate()
	date: unknown;
}

class OptionalCalendarDateDto {
	@IsOptional()
	@IsCalendarDate()
	date?: unknown;
}

function constraints(date: unknown) {
	return validateSync(Object.assign(new CalendarDateDto(), {date}))[0]?.constraints ?? {};
}

const validDates = ['2026-10-18', '2024-02-29', '2000-02-29'];
const invalidDates = [
	'0050-04-01',
	'2026-02-30',
	'2026-02-29',
	'1900-02-29',
	'2026-13-01',
	'2026-10-32',
	'2026-1-01',
	'2026-10-1',
	'2026-10-18T00:00:00.000Z',
	' 2026-10-18',
	'2026-10-18 ',
	'',
	undefined,
	null,
	20261018,
	new Date('2026-10-18T00:00:00.000Z'),
];

describe('calendar-date validation', () => {
	it.each(validDates)('accepts the calendar date %s', (date) => {
		expect(constraints(date)).toEqual({});
	});

	it.each(invalidDates)('rejects %p', (date) => {
		expect(Object.keys(constraints(date))).not.toHaveLength(0);
	});

	it('reports the matches and isDateString constraints with their messages', () => {
		expect(constraints('2026-02-30')).toEqual({isDateString: 'date must be a valid ISO 8601 date string'});
		expect(constraints('invalid')).toEqual({
			matches: 'date must match /^\\d{4}-\\d{2}-\\d{2}$/ regular expression',
			isDateString: 'date must be a valid ISO 8601 date string',
		});
		expect(Object.keys(constraints('invalid'))).toEqual(['matches', 'isDateString']);
	});

	it.each([undefined, null])('allows %p only when the caller marks the date optional', (date) => {
		expect(validateSync(Object.assign(new OptionalCalendarDateDto(), {date}))).toEqual([]);
		expect(Object.keys(constraints(date))).not.toHaveLength(0);
	});

	it.each([...validDates, ...invalidDates])(
		'keeps the booking-date and summary validation aligned for %p',
		(date) => {
			const booking = validateSync(
				Object.assign(new BankTransactionBookingDateFilterDto(), {from: date, to: date}),
			);
			const summary = validateSync(
				Object.assign(new BankTransactionSummaryQueryDto(), {month: '2026-10', asOf: date}),
			);
			const requiredConstraints = Object.keys(constraints(date));
			const optionalConstraints = date == null ? [] : requiredConstraints;

			for (const property of ['from', 'to']) {
				expect(Object.keys(booking.find((error) => error.property === property)?.constraints ?? {})).toEqual(
					optionalConstraints,
				);
			}
			expect(Object.keys(summary.find((error) => error.property === 'asOf')?.constraints ?? {})).toEqual(
				requiredConstraints,
			);
		},
	);

	it.each(['0050-04', '2026-1', '2026-13'])('rejects the summary month %s', (month) => {
		const errors = validateSync(Object.assign(new BankTransactionSummaryQueryDto(), {month, asOf: '2026-10-18'}));
		expect(errors.map(({property}) => property)).toEqual(['month']);
	});
});
