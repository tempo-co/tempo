import {MAX_SAVED_LAYOUTS, MAX_SAVED_LAYOUT_BYTES} from './bank-import-layout.service';
import {MAX_REQUEST_BYTES} from './runner/parse-runner.protocol';

describe('saved layout limits', () => {
	it("keep an owner's every saved layout inside one request to the file reader", () => {
		// The request line also holds the mode and the JSON list around the layouts.
		expect(MAX_SAVED_LAYOUTS * (MAX_SAVED_LAYOUT_BYTES + 1) + 64).toBeLessThan(MAX_REQUEST_BYTES);
	});
});
