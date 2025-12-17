import test from 'tape';

import maybeStripColors from '../maybeStripColors.mjs';

const coloredText = '\u001B[31mRed text\u001B[0m and \u001B[32mgreen text\u001B[0m';
const strippedText = 'Red text and green text';

test('maybeStripColors', (t) => {
	t.equal(typeof maybeStripColors, 'function', 'is a function');

	t.test('strips colors when NO_COLOR is set', (st) => {
		const originalNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = '1';
		st.teardown(() => {
			if (originalNoColor === undefined) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = originalNoColor;
			}
		});

		st.equal(maybeStripColors(coloredText), strippedText, 'ANSI codes are stripped');
		st.end();
	});

	t.test('strips colors when NO_COLOR is empty string', (st) => {
		const originalNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = '';
		st.teardown(() => {
			if (originalNoColor === undefined) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = originalNoColor;
			}
		});

		st.equal(maybeStripColors(coloredText), strippedText, 'ANSI codes are stripped even with empty NO_COLOR');
		st.end();
	});

	t.test('strips colors when stdout is not a TTY', (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process.stdout)), 'isTTY', { value: false });

		const originalNoColor = process.env.NO_COLOR;
		delete process.env.NO_COLOR;
		st.teardown(() => {
			if (originalNoColor !== undefined) {
				process.env.NO_COLOR = originalNoColor;
			}
		});

		st.equal(maybeStripColors(coloredText), strippedText, 'ANSI codes are stripped when not a TTY');
		st.end();
	});

	t.test('preserves colors when stdout is a TTY and NO_COLOR is not set', (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process.stdout)), 'isTTY', { value: true });

		const originalNoColor = process.env.NO_COLOR;
		delete process.env.NO_COLOR;
		st.teardown(() => {
			if (originalNoColor !== undefined) {
				process.env.NO_COLOR = originalNoColor;
			}
		});

		st.equal(maybeStripColors(coloredText), coloredText, 'ANSI codes are preserved');
		st.end();
	});

	t.test('returns empty string unchanged', (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process.stdout)), 'isTTY', { value: true });

		const originalNoColor = process.env.NO_COLOR;
		delete process.env.NO_COLOR;
		st.teardown(() => {
			if (originalNoColor !== undefined) {
				process.env.NO_COLOR = originalNoColor;
			}
		});

		st.equal(maybeStripColors(''), '', 'empty string is unchanged');
		st.end();
	});

	t.test('returns plain text unchanged', (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process.stdout)), 'isTTY', { value: true });

		const originalNoColor = process.env.NO_COLOR;
		delete process.env.NO_COLOR;
		st.teardown(() => {
			if (originalNoColor !== undefined) {
				process.env.NO_COLOR = originalNoColor;
			}
		});

		const plainText = 'Hello, world!';
		st.equal(maybeStripColors(plainText), plainText, 'plain text is unchanged');
		st.end();
	});

	t.end();
});
