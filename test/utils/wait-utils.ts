/** Re-reads until the value matches, for effects that background workers finish after the request returns. */
export async function waitFor<T>(
	read: () => Promise<T>,
	predicate: (value: T) => boolean,
	timeoutMs = 10_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let value = await read();
	while (!predicate(value) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		value = await read();
	}
	if (!predicate(value))
		throw new Error(`Timed out after ${timeoutMs}ms waiting for the expected response: ${JSON.stringify(value)}`);
	return value;
}
