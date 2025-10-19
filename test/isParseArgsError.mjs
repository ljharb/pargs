import test from 'tape';
import v from 'es-value-fixtures';
import inspect from 'object-inspect';
import { parseArgs } from 'util';

import isParseArgsError from '../isParseArgsError.mjs';

test('isParseArgsError', (t) => {
	t.equal(typeof isParseArgsError, 'function', 'is a function');

	(/** @type {(typeof v.primitives)[number] | function} */ [].concat(
		// @ts-expect-error TS sucks with concat
		v.primitives,
		() => {},
	)).forEach((x) => {
		t.equal(isParseArgsError(x), false, `${inspect(x)} is not an object`);
	});

	t.equal(isParseArgsError({}), false, 'object must be an Error');

	const err = new Error();
	t.equal(isParseArgsError(err), false, 'error must have a `code` property');

	try {
		parseArgs({
			args: ['--bar'],
			options: { foo: { type: 'boolean' } },
		});
		t.fail();
	} catch (e) {
		// @ts-expect-error
		t.equal(e.code, 'ERR_PARSE_ARGS_UNKNOWN_OPTION');
		t.equal(isParseArgsError(e), true, 'unknown option');
	}

	try {
		parseArgs({
			args: ['--foo=bar'],
			options: { foo: { type: 'boolean' } },
		});
		t.fail();
	} catch (e) {
		// @ts-expect-error
		t.equal(e.code, 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE');
		t.equal(isParseArgsError(e), true, 'invalid option value');
	}

	try {
		// @ts-expect-error
		parseArgs({ args: true });
		t.fail();
	} catch (e) {
		// @ts-expect-error
		t.equal(e.code, 'ERR_INVALID_ARG_TYPE');
		t.equal(isParseArgsError(e), true, 'invalid argument config type');
	}

	try {
		parseArgs(({ args: [], options: { foo: { type: 'boolean', short: 'fo' } } }));
		t.fail();
	} catch (e) {
		// @ts-expect-error
		t.equal(e.code, 'ERR_INVALID_ARG_VALUE');
		t.equal(isParseArgsError(e), true, 'invalid argument config value');
	}

	try {
		parseArgs({ args: ['foo'], allowPositionals: false });
		t.fail();
	} catch (e) {
		// @ts-expect-error
		t.equal(e.code, 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL');
		t.equal(isParseArgsError(e), true, 'unexpected positional');
	}

	t.end();
});
