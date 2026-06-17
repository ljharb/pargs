import test from 'tape';
import { writeFile } from 'fs/promises';
import { mkdirSync, realpathSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import tmp from 'tmp';

import pargs from '../index.mjs';
import generateHelp from '../generateHelp.mjs';
import getHelpText, { getVersion } from '../getHelpText.mjs';

const filename = fileURLToPath(import.meta.url);

/** @type {(dirPath: string, removeCallback: Function) => () => void} */
function emptyFirst(dirPath, removeCallback) {
	return function () {
		rmSync(dirPath, { recursive: true, force: true });
		try {
			removeCallback();
		} catch (e) {
			if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'ENOENT') {
				throw e;
			}
		}
	};
}

test('pargs - help option reservation', async (t) => {
	try {
		// @ts-expect-error
		await pargs(filename, { help: true });
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when help is in root config');
		if (e instanceof TypeError) {
			t.match(e.message, /help.*reserved/i, 'error message mentions help is reserved');
		}
	}

	try {
		await pargs(filename, { options: { help: { type: 'boolean' } } });
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when help is in options');
		t.match(
			String(e && typeof e === 'object' && 'message' in e && e.message),
			/help.*reserved/i,
			'error message mentions help is reserved',
		);
	}
});

test('pargs - a user-defined version option is preferred over the built-in', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'package.json'), JSON.stringify({ version: '9.9.9' })),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--version'] });
	const result = await pargs(entrypoint, {
		options: { version: { type: 'boolean' } },
	});
	t.ok(result.values.version, 'the user-defined version option still parses');

	const logCapture = t.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
	t.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
		throw new Error('EXIT');
	});

	let helpError;
	try {
		await result.help();
	} catch (e) {
		helpError = e;
	}
	const logs = logCapture().map((call) => call.args.join(' '));

	t.notOk(helpError, 'help() does not exit on --version when the user owns the option');
	t.notOk(logs.some((log) => log.includes('9.9.9')), 'pargs does not auto-print the version when the user owns it');

	t.end();
});

test('pargs - version flag', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'package.json'), JSON.stringify({ version: '4.5.6' })),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--version'] });
	const result = await pargs(entrypoint, {
		options: { verbose: { type: 'boolean' } },
	});

	t.ok(result.values.version, '--version flag is set');

	const logCapture = t.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
	t.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
		throw new Error('EXIT');
	});

	let helpError;
	try {
		await result.help();
	} catch (e) {
		helpError = e;
	}
	const logs = logCapture().map((call) => call.args.join(' '));

	t.ok(helpError instanceof Error && helpError.message === 'EXIT', 'help() exits on --version');
	t.ok(logs.some((log) => log.includes('4.5.6')), 'prints the package version');
	t.ok(logs.some((log) => log.includes('v4.5.6')), 'version output is prefixed with `v`');
	t.notOk(logs.some((log) => log.includes('Usage')), 'does not print help text for --version');

	t.end();
});

test('getVersion - empty string when no package.json provides a version', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'cli.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'package.json'), '{}'),
	]);

	t.equal(await getVersion(realpathSync(entrypoint)), '', 'no version found yields an empty string');

	t.end();
});

test('pargs - subcommands validation', async (t) => {
	try {
		// @ts-expect-error
		await pargs(filename, { subcommands: null });
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when subcommands is null');
	}

	try {
		// @ts-expect-error
		await pargs(filename, { subcommands: 'invalid' });
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when subcommands is not an object');
	}

	try {
		await pargs(filename, { subcommands: {} });
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when subcommands is empty object');
	}
});

test('pargs - allowPositionals and subcommands are mutually exclusive', async (t) => {
	try {
		await pargs(filename, {
			allowPositionals: true,
			subcommands: { foo: {} },
		});
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when both allowPositionals and subcommands are defined');
	}

	try {
		await pargs(filename, {
			allowPositionals: 2,
			subcommands: { foo: {} },
		});
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when allowPositionals is a number and subcommands are defined');
	}
});

test('pargs - minPositionals and subcommands are mutually exclusive', async (t) => {
	try {
		await pargs(filename, {
			minPositionals: 2,
			subcommands: { foo: {} },
		});
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when both minPositionals and subcommands are defined');
	}

	try {
		await pargs(filename, {
			minPositionals: 2,
			subcommands: { foo: {} },
		});
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when minPositionals is a number and subcommands are defined');
	}
});

test('pargs - enum choices validation', async (t) => {
	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, filename] });

	try {
		await pargs(filename, {
			options: {
				level: {
					type: 'enum',
					// @ts-expect-error
					choices: 'invalid',
				},
			},
		});
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when choices is not an array');
	}

	try {
		await pargs(filename, {
			options: {
				level: {
					type: 'enum',
					// @ts-expect-error
					choices: [1, 2, 3],
				},
			},
		});
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when choices contains non-strings');
	}

	try {
		await pargs(filename, {
			options: {
				level: {
					type: 'enum',
					// @ts-expect-error
					choices: ['debug', 'info', 123],
				},
			},
		});
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws TypeError when choices contains mixed types');
	}
});

test('pargs - boolean option mutual exclusivity', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('--verbose and --no-verbose are mutually exclusive', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--verbose', '--no-verbose'] });
		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean' },
			},
		});
		st.ok(result.errors.length > 0, 'has errors when both --verbose and --no-verbose are provided');
		st.ok(
			result.errors.some((e) => e.includes('mutually exclusive')),
			'error mentions mutual exclusivity',
		);
	});

	t.test('--help and --no-help are mutually exclusive', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--help', '--no-help'] });
		const result = await pargs(entrypoint, {
			options: {
				debug: { type: 'boolean' },
			},
		});
		st.ok(result.errors.length > 0, 'has errors when both --help and --no-help are provided');
	});

	t.test('--no-flag works correctly', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--no-verbose'] });
		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean', default: true },
			},
		});
		st.equal(result.values.verbose, false, '--no-verbose sets value to false');
		st.notOk('no-verbose' in result.values, 'no-verbose is removed from values');
	});
});

test('pargs - unknown options detection', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('unknown option on root', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--unknown'] });
		const result = await pargs(entrypoint, {
			options: {
				known: { type: 'boolean' },
			},
		});
		st.ok(result.errors.length > 0, 'has errors for unknown option');
		st.ok(
			result.errors.some((e) => e.includes('Unknown option')),
			'error mentions unknown option',
		);
	});

	t.test('multiple unknown options', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--foo', '--bar'] });
		const result = await pargs(entrypoint, {
			options: {
				known: { type: 'boolean' },
			},
		});
		st.ok(result.errors.length > 0, 'has errors for multiple unknown options');
	});
});

test('pargs - subcommands functionality', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('valid subcommand', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'build', '--verbose'] });
		const result = await pargs(entrypoint, {
			subcommands: {
				build: {
					options: {
						verbose: { type: 'boolean' },
					},
				},
			},
		});
		st.equal(result.command.name, 'build', 'command name is set');
		st.equal(result.command.values.verbose, true, 'subcommand option is parsed');
		st.equal(result.errors.length, 0, 'no errors for valid subcommand');
	});

	t.test('unknown subcommand', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'unknown'] });
		const result = await pargs(entrypoint, {
			subcommands: {
				build: {},
			},
		});
		st.ok(result.errors.length > 0, 'has errors for unknown subcommand');
		st.ok(
			result.errors.some((e) => e.includes('unknown command')),
			'error mentions unknown command',
		);
	});

	t.test('unknown option in subcommand', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'build', '--unknown'] });
		const result = await pargs(entrypoint, {
			subcommands: {
				build: {
					options: {
						verbose: { type: 'boolean' },
					},
				},
			},
		});
		st.ok(result.command.errors.length > 0, 'subcommand has errors for unknown option');
	});
});

test('pargs - default subcommand', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('routes a non-subcommand positional to the default command', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'some-input', '--json'] });
		const result = await pargs(entrypoint, {
			defaultCommand: 'run',
			subcommands: {
				run: {
					options: { json: { type: 'boolean' } },
					allowPositionals: 1,
				},
			},
		});
		st.equal(result.command.name, 'run', 'routed to the default command');
		st.equal(result.command.values.json, true, 'default command parsed its option');
		st.deepEqual(result.command.positionals, ['some-input'], 'default command received the positional');
		st.equal(result.errors.length, 0, 'no errors');
	});

	t.test('routes a flag-first invocation to the default command', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--json'] });
		const result = await pargs(entrypoint, {
			defaultCommand: 'run',
			subcommands: {
				run: { options: { json: { type: 'boolean' } } },
			},
		});
		st.equal(result.command.name, 'run', 'routed to default with a leading flag');
		st.equal(result.command.values.json, true, 'parsed the flag against the default command');
		st.equal(result.errors.length, 0, 'no errors');
	});

	t.test('routes a bare invocation (no args) to the default command', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			defaultCommand: 'run',
			subcommands: {
				run: { options: { json: { type: 'boolean', default: false } } },
			},
		});
		st.equal(result.command.name, 'run', 'routed to default when no args are given');
		st.equal(result.command.values.json, false, 'used the default option value');
		st.equal(result.errors.length, 0, 'no errors');
	});

	t.test('a known subcommand takes precedence over the default command', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'other', '--verbose'] });
		const result = await pargs(entrypoint, {
			defaultCommand: 'run',
			subcommands: {
				run: {},
				other: { options: { verbose: { type: 'boolean' } } },
			},
		});
		st.equal(result.command.name, 'other', 'used the explicitly named subcommand');
		if (result.command.name === 'other') {
			st.equal(result.command.values.verbose, true, 'parsed the named subcommand option');
		}
		st.equal(result.errors.length, 0, 'no errors');
	});
});

test('pargs - defaultCommand: root --help and --version apply at the root', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'package.json'), JSON.stringify({ version: '2.3.4' })),
	]);

	const config = /** @type {import('../index.d.mts').PargsRootConfig} */ ({
		defaultCommand: 'run',
		subcommands: {
			run: {
				options: { json: { type: 'boolean' } },
				allowPositionals: 1,
			},
			other: {},
		},
	});

	t.test('root --help shows the command list, not the default command help', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--help'] });
		const result = await pargs(entrypoint, config);

		const logCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
		st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
			throw new Error('EXIT');
		});

		let helpError;
		try {
			await result.help();
		} catch (e) {
			helpError = e;
		}
		const logs = logCapture().map((call) => call.args.join(' '));

		st.ok(helpError instanceof Error && helpError.message === 'EXIT', 'help() exits');
		st.ok(logs.some((log) => log.includes('Commands:') && log.includes('other')), 'root help lists the subcommands, not just the default command');
	});

	t.test('root --version prints the version', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--version'] });
		const result = await pargs(entrypoint, config);

		const logCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
		st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
			throw new Error('EXIT');
		});

		try {
			await result.help();
		} catch { /**/ }
		const logs = logCapture().map((call) => call.args.join(' '));

		st.ok(logs.some((log) => log.includes('2.3.4')), 'prints the package version at the root level');
		st.ok(logs.some((log) => log.includes('v2.3.4')), 'version output is prefixed with `v`');
	});
});

test('pargs - defaultCommand validation', async (t) => {
	try {
		await pargs(filename, { defaultCommand: 'run' });
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws when defaultCommand is set without subcommands');
		t.match(
			String(e && typeof e === 'object' && 'message' in e && e.message),
			/defaultCommand.*subcommands/i,
			'error message mentions subcommands',
		);
	}

	try {
		await pargs(filename, { defaultCommand: 'missing', subcommands: { run: {} } });
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'throws when defaultCommand is not a subcommand key');
		t.match(
			String(e && typeof e === 'object' && 'message' in e && e.message),
			/defaultCommand.*key/i,
			'error message mentions it must be a key',
		);
	}
});

test('pargs - allowPositionals functionality', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('allowPositionals as boolean (true)', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js', 'file3.js'] });
		const result = await pargs(entrypoint, {
			allowPositionals: true,
		});
		st.equal(result.positionals.length, 3, 'parses all positionals when allowPositionals is true');
		st.equal(result.errors.length, 0, 'no errors when positionals are allowed');
	});

	t.test('allowPositionals as number', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js'] });
		const result = await pargs(entrypoint, {
			allowPositionals: 2,
		});
		st.equal(result.positionals.length, 2, 'parses positionals when within limit');
		st.equal(result.errors.length, 0, 'no errors when positional count is within limit');
	});

	t.test('too many positionals', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js', 'file3.js'] });
		const result = await pargs(entrypoint, {
			allowPositionals: 2,
		});
		st.ok(result.errors.length > 0, 'has errors when too many positionals');
		st.ok(
			result.errors.some((e) => e.includes('Only 2 positional')),
			'error mentions positional limit',
		);
	});

	t.test('allowPositionals in subcommand', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'build', 'file1.js'] });
		const result = await pargs(entrypoint, {
			subcommands: {
				build: {
					allowPositionals: 1,
				},
			},
		});
		st.equal(result.command.positionals.length, 1, 'subcommand parses positionals');
		st.equal(result.command.errors.length, 0, 'no errors in subcommand with allowed positionals');
	});
});

test('pargs - minPositionals functionality', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);
	t.test('not enough positionals', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'file1.js'] });
		const result = await pargs(entrypoint, {
			allowPositionals: true,
			minPositionals: 2,
		});
		st.ok(result.errors.length > 0, 'has errors when not enough positionals');
		st.ok(
			result.errors.some((e) => e.includes('At least 2 positional')),
			'error mentions minimum positional requirement',
		);
	});

	t.test('too many positionals', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js', 'file3.js'] });
		const result = await pargs(entrypoint, {
			allowPositionals: 2,
			minPositionals: 1,
		});
		st.ok(result.errors.length > 0, 'has errors when too many positionals');
		st.ok(
			result.errors.some((e) => e.includes('Only 2 positional')),
			'error mentions maximum positional limit',
		);
	});

	t.test('min number of positionals', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js'] });
		const result = await pargs(entrypoint, {
			allowPositionals: true,
			minPositionals: 2,
		});
		st.equal(result.positionals.length, 2, 'parses exactly minimum number of positionals');
		st.equal(result.errors.length, 0, 'no errors when minimum positionals provided');
	});

	t.test('minPositionals in subcommand', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'build', 'file1.js'] });
		const notEnoughResult = await pargs(entrypoint, {
			subcommands: {
				build: {
					allowPositionals: true,
					minPositionals: 2,
				},
			},
		});
		st.ok(notEnoughResult.command.errors.length > 0, 'subcommand has errors when not enough positionals');
		st.ok(
			notEnoughResult.command.errors.some((e) => e.includes('At least 2 positional')),
			'error mentions minimum requirement in subcommand',
		);

		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'build', 'file1.js', 'file2.js', 'file3.js'] });
		const tooManyResult = await pargs(entrypoint, {
			subcommands: {
				build: {
					allowPositionals: 2,
					minPositionals: 1,
				},
			},
		});
		st.ok(tooManyResult.command.errors.length > 0, 'subcommand has errors when too many positionals');
		st.ok(
			tooManyResult.command.errors.some((e) => e.includes('Only 2 positional')),
			'error mentions maximum limit in subcommand',
		);
	});

	t.test('--help with missing required positionals does not error', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--help'] });
		const result = await pargs(entrypoint, {
			allowPositionals: true,
			minPositionals: 2,
		});
		st.equal(result.errors.length, 0, 'no errors when --help is provided');
		st.ok(result.values.help, '--help flag is set');
	});
});

test('pargs - enum validation', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('valid enum value', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--level=debug'] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info', 'warn', 'error'],
				},
			},
		});
		st.equal(result.values.level, 'debug', 'parses valid enum value');
		st.equal(result.errors.length, 0, 'no errors for valid enum value');
	});

	t.test('invalid enum value', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--level=invalid'] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info', 'warn', 'error'],
				},
			},
		});
		st.ok(result.errors.length > 0, 'has errors for invalid enum value');
		st.ok(
			result.errors.some((e) => e.includes('Invalid value for option "level"')),
			'error mentions invalid enum value',
		);
	});

	t.test('enum with default', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info', 'warn', 'error'],
					default: 'info',
				},
			},
		});
		st.equal(result.values.level, 'info', 'uses default enum value');
		st.equal(result.errors.length, 0, 'no errors with default enum value');
	});
});

test('pargs - number type validation', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('valid number value', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--port=8080'] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number' },
			},
		});
		st.equal(result.values.port, 8080, 'parses valid number value');
		st.equal(typeof result.values.port, 'number', 'coerces to number type');
		st.equal(result.errors.length, 0, 'no errors for valid number');
	});

	t.test('valid negative number', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--offset=-3.5'] });
		const result = await pargs(entrypoint, {
			options: {
				offset: { type: 'number' },
			},
		});
		st.equal(result.values.offset, -3.5, 'parses negative float');
		st.equal(result.errors.length, 0, 'no errors for negative number');
	});

	t.test('invalid number value', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--port=abc'] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number' },
			},
		});
		st.ok(result.errors.length > 0, 'has errors for invalid number');
		st.ok(
			result.errors.some((e) => e.includes('Invalid number value for option "port"')),
			'error mentions invalid number value',
		);
	});

	t.test('Infinity is not a valid number', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--port=Infinity'] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number' },
			},
		});
		st.ok(result.errors.length > 0, 'has errors for Infinity');
		st.ok(
			result.errors.some((e) => e.includes('Invalid number value')),
			'error mentions invalid number',
		);
	});

	t.test('number with default (not provided)', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number', default: 3e3 },
			},
		});
		st.equal(result.values.port, 3000, 'coerces default value to number');
		st.equal(result.errors.length, 0, 'no errors with default');
	});

	t.test('number with numeric default (not provided)', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number', default: 3e3 },
			},
		});
		st.equal(result.values.port, 3e3, 'coerces numeric default value to number');
		st.equal(result.errors.length, 0, 'no errors with numeric default');
	});

	t.test('number with multiple and numeric defaults (not provided)', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number', multiple: true, default: [80, 443] },
			},
		});
		st.deepEqual(result.values.port, [80, 443], 'coerces numeric array defaults to numbers');
		st.equal(result.errors.length, 0, 'no errors with numeric array defaults');
	});

	t.test('number not provided without default', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number' },
			},
		});
		st.notOk('port' in result.values, 'port is absent when not provided and no default');
		st.equal(result.errors.length, 0, 'no errors when an optional number is omitted');
	});

	t.test('number with multiple', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--port=80', '--port=443'] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number', multiple: true },
			},
		});
		st.deepEqual(result.values.port, [80, 443], 'parses multiple number values');
		st.equal(result.errors.length, 0, 'no errors for valid multiple numbers');
	});

	t.test('number with multiple, one invalid', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--port=80', '--port=abc'] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number', multiple: true },
			},
		});
		st.ok(result.errors.length > 0, 'has errors for invalid number in multiple');
	});
});

test('pargs - integer type validation', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('valid integer value', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--count=42'] });
		const result = await pargs(entrypoint, {
			options: {
				count: { type: 'integer' },
			},
		});
		st.equal(result.values.count, 42, 'parses valid integer value');
		st.equal(typeof result.values.count, 'number', 'coerces to number type');
		st.equal(result.errors.length, 0, 'no errors for valid integer');
	});

	t.test('float is not a valid integer', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--count=3.14'] });
		const result = await pargs(entrypoint, {
			options: {
				count: { type: 'integer' },
			},
		});
		st.ok(result.errors.length > 0, 'has errors for float as integer');
		st.ok(
			result.errors.some((e) => e.includes('Invalid integer value for option "count"')),
			'error mentions invalid integer value',
		);
	});

	t.test('non-numeric string is not a valid integer', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--count=abc'] });
		const result = await pargs(entrypoint, {
			options: {
				count: { type: 'integer' },
			},
		});
		st.ok(result.errors.length > 0, 'has errors for non-numeric integer');
		st.ok(
			result.errors.some((e) => e.includes('Invalid integer value')),
			'error mentions invalid integer',
		);
	});

	t.test('negative integer is valid', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--count=-5'] });
		const result = await pargs(entrypoint, {
			options: {
				count: { type: 'integer' },
			},
		});
		st.equal(result.values.count, -5, 'parses negative integer');
		st.equal(result.errors.length, 0, 'no errors for negative integer');
	});

	t.test('integer with multiple', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--id=1', '--id=2', '--id=3'] });
		const result = await pargs(entrypoint, {
			options: {
				id: { type: 'integer', multiple: true },
			},
		});
		st.deepEqual(result.values.id, [1, 2, 3], 'parses multiple integer values');
		st.equal(result.errors.length, 0, 'no errors for valid multiple integers');
	});

	t.test('integer with multiple, one float', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--id=1', '--id=2.5'] });
		const result = await pargs(entrypoint, {
			options: {
				id: { type: 'integer', multiple: true },
			},
		});
		st.ok(result.errors.length > 0, 'has errors for float in multiple integers');
	});
});

test('pargs - help functionality', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'This is help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('--help flag', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--help'] });
		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean' },
			},
		});

		st.equal(typeof result.help, 'function', 'result has help function');

		const logCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
		const exitCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
			throw new Error('EXIT');
		});

		try {
			await result.help();
		} catch (e) {
			st.ok(e instanceof Error, 'process.exit mock throws');
		}

		const logs = logCapture().map((call) => call.args.join(' '));
		const exitCalls = exitCapture();

		st.equal(exitCalls.length, 1, 'help() calls process.exit once');
		st.ok(logs.some((log) => log.includes('This is help text')), 'help() outputs help text to console.log');
	});

	t.test('help with errors', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--unknown'] });
		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean' },
			},
		});

		st.ok(result.errors.length > 0, 'result has errors before calling help');
		st.equal(typeof result.help, 'function', 'result has help function');
		st.notOk(result.values.help, '--help flag should not be set');

		const logCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
		const errorCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'error');
		const exitCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
			throw new Error('EXIT');
		});

		const originalExitCode = process.exitCode;

		try {
			await result.help();
		} catch (e) {
			st.ok(e instanceof Error, 'process.exit mock throws');
		}

		const logs = logCapture().map((call) => call.args.join(' '));
		const errors = errorCapture().map((call) => call.args.join(' '));
		const exitCalls = exitCapture();
		const capturedExitCode = process.exitCode;

		process.exitCode = originalExitCode;

		st.equal(exitCalls.length, 1, 'help() with errors calls process.exit');
		st.ok(errors.length > 0, 'console.error was called');
		st.ok(logs.some((log) => log.includes('This is help text')), 'help text was output to stdout');
		st.ok(errors.some((err) => err.includes('Unknown option')), 'help() outputs errors to stderr');
		st.ok(Number(capturedExitCode) > 0, 'process.exitCode was set to non-zero');
	});
});

test('pargs - argv filtering', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--flag', 'value'] });
	const result = await pargs(entrypoint, {
		options: {
			flag: { type: 'string' },
		},
		allowPositionals: true,
	});

	t.equal(result.values.flag, 'value', 'parses options correctly');
	t.notOk(
		result.positionals.includes(process.execPath),
		'execPath is not in positionals',
	);
	t.notOk(
		result.positionals.includes(entrypoint),
		'entrypoint is not in positionals',
	);
});

test('pargs - boolean type validation', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help text'),
		writeFile(entrypoint, '// test file'),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--verbose=yes'] });
	const result = await pargs(entrypoint, {
		options: {
			verbose: { type: 'boolean' },
		},
	});

	t.ok(result.errors.length > 0, 'has errors when boolean option has value');
	t.ok(
		result.errors.some((e) => e.includes('does not take an argument')),
		'error mentions argument rejection',
	);
});

test('pargs - help() error output path coverage', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Help text for errors'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('help() with enum error', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--level=invalid'] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info', 'warn'],
				},
			},
		});

		st.ok(result.errors.length > 0, 'has errors');
		st.notOk(result.values.help, '--help flag should be false');

		const logCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
		const errorCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'error');
		const exitCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
			throw new Error('EXIT');
		});

		const originalExitCode = process.exitCode;
		process.exitCode = undefined;

		try {
			await result.help();
		} catch (e) {
			st.ok(e instanceof Error, 'process.exit mock throws');
		}

		const logs = logCapture().map((call) => call.args.join(' '));
		const errors = errorCapture().map((call) => call.args.join(' '));
		const exitCalls = exitCapture();
		const capturedExitCode = process.exitCode;

		process.exitCode = originalExitCode;

		st.equal(exitCalls.length, 1, 'help() was called and exited');
		st.ok(logs.some((log) => log.includes('Help text for errors')), 'help text was output to stderr');
		st.ok(errors.some((err) => err.includes('Invalid value for option "level"')), 'errors were output to stdout');
		st.ok(Number(capturedExitCode) > 0, 'process.exitCode was set');
	});
});

test('pargs - rethrows non-ParseArgsError exceptions', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help'),
		writeFile(entrypoint, '// test file'),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'build'] });

	try {
		await pargs(entrypoint, {
			subcommands: {
				build: {
					// @ts-expect-error
					help: true,
				},
			},
		});
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof TypeError, 'error is a TypeError');
		t.match(
			String(e && typeof e === 'object' && 'message' in e && e.message),
			/help.*reserved/i,
			'error message mentions help is reserved',
		);
	}
});

test('pargs - no options with strict false', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help'),
		writeFile(entrypoint, '// test file'),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--anything'] });
	const result = await pargs(entrypoint, {});

	t.ok(result.errors.length > 0, 'has errors for unknown option with no options defined');
	t.ok(
		result.errors.some((e) => e.includes('Unknown option')),
		'error mentions unknown option',
	);
});

test('pargs - tokens option', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help'),
		writeFile(entrypoint, '// test file'),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--verbose'] });
	const result = await pargs(entrypoint, {
		options: {
			verbose: { type: 'boolean' },
		},
		tokens: true,
	});

	t.ok('tokens' in result, 'result has tokens property');
	t.ok(Array.isArray(result.tokens), 'tokens is an array');
});

test('pargs - tokens option on error path', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help'),
		writeFile(entrypoint, '// test file'),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--verbose=yes'] });
	const result = await pargs(entrypoint, {
		options: {
			verbose: { type: 'boolean' },
		},
		tokens: true,
	});

	t.ok(result.errors.length > 0, 'has errors when parseArgs fails');
	t.ok('tokens' in result, 'result still has tokens property on error');
	t.ok(Array.isArray(result.tokens), 'tokens is an array on error path');
});

test('pargs - tokens option with unexpected positionals', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help'),
		writeFile(entrypoint, '// test file'),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'unexpected-positional'] });
	const result = await pargs(entrypoint, {
		options: {
			verbose: { type: 'boolean' },
		},
		tokens: true,
	});

	t.ok(result.errors.length > 0, 'has errors when unexpected positional is provided');
	t.ok(
		result.errors.some((e) => e.includes('does not take positional arguments')),
		'error mentions positional arguments not allowed',
	);
	t.ok('tokens' in result, 'result still has tokens property with unexpected positional');
	t.ok(Array.isArray(result.tokens), 'tokens is an array with unexpected positional');
});

test('pargs - subcommand without name in argv', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Test help'),
		writeFile(entrypoint, '// test file'),
	]);

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint] });
	const result = await pargs(entrypoint, {
		subcommands: {
			build: {},
		},
	});

	t.ok(result.errors.length > 0, 'has errors for missing subcommand');
	t.ok(
		result.errors.some((e) => e.includes('unknown command')),
		'error mentions unknown command',
	);
});

test('pargs - subcommand with custom help function', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	await Promise.all([
		writeFile(helpPath, 'Main help'),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('subcommand help function', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, 'build', '--help'] });
		const result = await pargs(entrypoint, {
			subcommands: {
				build: {
					options: {
						verbose: { type: 'boolean' },
					},
				},
			},
		});

		st.ok('command' in result, 'result has command property');
		st.equal(typeof result.command.help, 'function', 'command has help function');
		st.ok(result.command.values.help, '--help flag is set in subcommand');
	});
});

test('pargs - color stripping in help text', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const helpPath = join(testDir, 'help.txt');
	const entrypoint = join(testDir, 'test.mjs');

	const coloredHelp = '\u001B[31mRed text\u001B[0m and \u001B[32mgreen text\u001B[0m';
	const strippedHelp = 'Red text and green text';

	await Promise.all([
		writeFile(helpPath, coloredHelp),
		writeFile(entrypoint, '// test file'),
	]);

	t.test('strips colors when NO_COLOR is set', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--help'] });

		// Manually set NO_COLOR for this test
		const originalNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = '1';
		st.teardown(() => {
			if (originalNoColor === undefined) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = originalNoColor;
			}
		});

		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean' },
			},
		});

		st.ok(result.values.help, '--help flag is set');

		const logCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
		st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
			throw new Error('EXIT');
		});

		let helpError;
		try {
			await result.help();
		} catch (e) {
			helpError = e;
		}

		// Stop capturing console.log before making assertions (tape uses console.log)
		const logs = logCapture().map((call) => call.args.join(' '));

		st.ok(helpError instanceof Error && helpError.message === 'EXIT', 'help() called process.exit');
		st.ok(logs.length > 0, 'console.log was called');
		st.ok(logs.some((log) => log.includes(strippedHelp)), 'ANSI codes are stripped when NO_COLOR is set');
		st.notOk(logs.some((log) => log.includes('\u001B[')), 'no ANSI escape codes in output');
	});

	t.test('strips colors when stdout is not a TTY', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--help'] });
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process.stdout)), 'isTTY', { value: false });

		// Set up captures before any operations that might use them
		const logCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
		st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
			throw new Error('EXIT');
		});

		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean' },
			},
		});

		let helpError;
		try {
			await result.help();
		} catch (e) {
			helpError = e;
		}

		// Stop capturing console.log before making assertions (tape uses console.log)
		const logs = logCapture().map((call) => call.args.join(' '));

		st.ok(result.values.help, '--help flag is set');
		st.ok(helpError instanceof Error && helpError.message === 'EXIT', 'help() called process.exit');
		st.ok(logs.length > 0, 'console.log was called');
		st.ok(logs.some((log) => log.includes(strippedHelp)), 'ANSI codes are stripped when not a TTY');
		st.notOk(logs.some((log) => log.includes('\u001B[')), 'no ANSI escape codes in output');
	});

	t.test('preserves colors when stdout is a TTY and NO_COLOR is not set', async (st) => {
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--help'] });
		st.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process.stdout)), 'isTTY', { value: true });

		// Ensure NO_COLOR is not set
		const originalNoColor = process.env.NO_COLOR;
		delete process.env.NO_COLOR;
		st.teardown(() => {
			if (originalNoColor !== undefined) {
				process.env.NO_COLOR = originalNoColor;
			}
		});

		// Set up captures before any operations that might use them
		const logCapture = st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
		st.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
			throw new Error('EXIT');
		});

		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean' },
			},
		});

		let helpError;
		try {
			await result.help();
		} catch (e) {
			helpError = e;
		}

		// Stop capturing console.log before making assertions (tape uses console.log)
		const logs = logCapture().map((call) => call.args.join(' '));

		st.ok(result.values.help, '--help flag is set');
		st.ok(helpError instanceof Error && helpError.message === 'EXIT', 'help() called process.exit');
		st.ok(logs.length > 0, 'console.log was called');
		st.ok(logs.some((log) => log.includes(coloredHelp)), 'ANSI codes are preserved when TTY and NO_COLOR not set');
	});
});

test('generateHelp - options', (t) => {
	const help = generateHelp('myapp', {
		options: {
			verbose: { type: 'boolean', short: 'v', description: 'Enable verbose output' },
			level: { type: 'enum', choices: ['debug', 'info', 'warn'], default: 'info', description: 'Log level' },
			port: { type: 'number', description: 'Port to listen on' },
			ports: { type: 'number', multiple: true, default: [80, 443] },
			tags: { type: 'string', multiple: true, default: [] },
			name: { type: 'string', multiple: true },
		},
		allowPositionals: true,
		minPositionals: 1,
	});

	t.match(help, /^Usage: myapp \[options\] <args\.\.\.>/, 'usage line shows options and required positionals');
	t.match(help, /-v, --\[no-\]verbose\s+Enable verbose output/, 'boolean with short flag is negatable and described');
	t.match(help, /--level <debug\|info\|warn>\s+Log level \(default: info\)/, 'enum lists choices and default');
	t.match(help, /--port <number>\s+Port to listen on/, 'number shows placeholder and description');
	t.match(help, /--ports <number>\.\.\.\s+\(default: \[80, 443\]\)/, 'multiple with non-empty array default is bracketed');
	t.match(help, /--tags <string>\.\.\.\s+\(default: \[\]\)/, 'multiple with empty array default renders as []');
	t.match(help, /--name <string>\.\.\./, 'string multiple without description');
	t.match(help, /--help\s+Show this help text/, 'always documents --help');

	t.end();
});

test('generateHelp - allowPositionals without minimum', (t) => {
	const help = generateHelp('myapp', { options: {}, allowPositionals: true });

	t.match(help, /^Usage: myapp \[--help\] \[args\.\.\.\]/, 'optional positionals shown when no minimum and no options');

	t.end();
});

test('generateHelp - subcommands', (t) => {
	const help = generateHelp('myapp', {
		subcommands: {
			build: { description: 'Build the project' },
			test: {},
		},
	});

	t.match(help, /^Usage: myapp <command> \[--help\]/, 'usage line shows command placeholder');
	t.match(help, /Commands:/, 'has a commands section');
	t.match(help, /build\s+Build the project/, 'subcommand with description');
	t.match(help, /\n {2}test\b/, 'subcommand without description');

	t.end();
});

test('generateHelp - empty config', (t) => {
	const help = generateHelp('myapp', {});

	t.match(help, /^Usage: myapp \[--help\]/, 'minimal usage line');
	t.match(help, /--help\s+Show this help text/, 'documents --help');
	t.doesNotMatch(help, /Commands:/, 'no commands section');

	t.end();
});

test('generateHelp - string description is treated as the summary', (t) => {
	const help = generateHelp('tool', { description: 'A short summary.' });

	t.match(help, /^A short summary\.\n\nUsage: tool/, 'string description becomes the top summary');

	t.end();
});

test('generateHelp - placeholders, positionals, groups, and structured description', (t) => {
	const help = generateHelp('mytool', {
		description: {
			summary: 'mytool - does a thing\nacross two lines',
			examples: [
				'mytool foo',
				{ command: 'mytool bar --json', description: 'as JSON' },
				{ command: 'mytool baz' },
			],
			sections: [
				{ title: 'Exit codes', body: '0  ok\n1  nope' },
			],
		},
		options: {
			before: { type: 'string', placeholder: 'MM/DD/YYYY', description: 'a date' },
			level: { type: 'enum', choices: ['a', 'b'], description: 'the level' },
			config: { type: 'string', group: 'Advanced', description: 'config path' },
		},
		allowPositionals: true,
		minPositionals: 1,
		positionals: [
			{ name: 'input', description: 'the input' },
			{ name: 'extra', rest: true },
		],
	});

	t.match(help, /^mytool - does a thing\nacross two lines\n/, 'summary printed at top');
	t.match(help, /Usage: mytool \[options\] <input> \[extra\.\.\.\]/, 'usage shows required and variadic positionals');
	t.match(help, /Arguments:\n {2}input +the input\n {2}extra\n/, 'arguments section lists named positionals, undescribed ones too');
	t.match(help, /--before <MM\/DD\/YYYY> +a date/, 'placeholder overrides the type-derived value name');
	t.match(help, /--level <a\|b> +the level/, 'enum still lists choices when no placeholder is given');
	t.match(help, /Options:\n[\s\S]*?--help/, 'default Options group carries --help');
	t.match(help, /Advanced:\n +--config <string> +config path/, 'grouped option rendered under its own section');
	t.match(help, /Examples:\n {2}mytool foo\n {2}mytool bar --json +as JSON\n {2}mytool baz\n/, 'examples with and without descriptions');
	t.match(help, /Exit codes:\n {2}0 +ok\n {2}1 +nope/, 'custom section rendered from title and body');

	t.end();
});

test('generateHelp - positionals without descriptions skip the Arguments section', (t) => {
	const help = generateHelp('tool', {
		positionals: [{ name: 'file' }],
	});

	t.match(help, /^Usage: tool \[--help\] \[file\]/, 'names the positional in usage even without a description or allowPositionals');
	t.doesNotMatch(help, /Arguments:/, 'no Arguments section when no positional has a description');

	t.end();
});

test('generateHelp - subcommand with a structured description summary', (t) => {
	const help = generateHelp('tool', {
		subcommands: {
			build: { description: { summary: 'Build it\nsecond line' } },
		},
	});

	t.match(help, /Commands:\n {2}build +Build it\b/, 'uses the structured summary first line in the command list');
	t.doesNotMatch(help, /second line/, 'only the first summary line is shown in the command list');

	t.end();
});

test('generateHelp - boolean defaults', (t) => {
	const help = generateHelp('tool', {
		options: {
			off: { type: 'boolean', default: false },
			on: { type: 'boolean', default: true },
			plain: { type: 'boolean' },
		},
	});

	t.doesNotMatch(help, /--\[no-\]off.*default/, 'omits (default: false) for a boolean defaulting to false');
	t.match(help, /--\[no-\]on +\(default: true\)/, 'shows (default: true) for a boolean defaulting to true');
	t.doesNotMatch(help, /--\[no-\]plain.*default/, 'shows no default when none is set');

	t.end();
});

test('generateHelp - a user-defined version option replaces the built-in --version row', (t) => {
	const help = generateHelp('tool', {
		options: {
			version: { type: 'boolean', short: 'v', description: 'print the version' },
		},
	});

	t.match(help, /-v, --\[no-\]version +print the version/, 'renders the user-defined version option');
	t.equal((help.match(/--(?:\[no-\])?version/g) || []).length, 1, 'no duplicate synthetic --version row is added');

	t.end();
});

test('generateHelp - defaultDescription overrides the shown default', (t) => {
	const help = generateHelp('tool', {
		options: {
			cache: { type: 'string', default: '/Users/me/.cache', defaultDescription: '$HOME/.cache' },
			token: { type: 'string', defaultDescription: 'ghp_…Onn' },
		},
	});

	t.match(help, /--cache <string> +\(default: \$HOME\/\.cache\)/, 'shows defaultDescription instead of the real default value');
	t.match(help, /--token <string> +\(default: ghp_…Onn\)/, 'shows defaultDescription even with no actual default');
	t.doesNotMatch(help, /\/Users\/me/, 'the real default value is not shown');

	t.end();
});

test('getHelpText - prefers help.txt when present', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');
	await writeFile(join(testDir, 'help.txt'), 'Explicit help text');

	const text = await getHelpText(entrypoint, { options: { verbose: { type: 'boolean' } } });
	t.equal(text, 'Explicit help text', 'returns help.txt contents verbatim, ignoring config');

	t.end();
});

test('getHelpText - generates from config when help.txt is missing', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');

	const text = await getHelpText(entrypoint, { options: { verbose: { type: 'boolean', description: 'be loud' } } });
	t.match(text, /Usage: test\.mjs/, 'usage line is generated from the entrypoint basename');
	t.match(text, /--\[no-\]verbose\s+be loud/, 'generated help includes configured options');

	t.end();
});

test('getHelpText - uses the matching package.json bin name', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'bin.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'package.json'), JSON.stringify({ name: '@scope/thing', bin: { 'my-cmd': './bin.mjs' } })),
	]);

	const text = await getHelpText(realpathSync(entrypoint), {});
	t.match(text, /^Usage: my-cmd\b/, 'usage line uses the bin key pointing at the entrypoint, not the filename');

	t.end();
});

test('getHelpText - falls back to the unscoped package name', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'bin.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'package.json'), JSON.stringify({ name: '@scope/thing' })),
	]);

	const text = await getHelpText(realpathSync(entrypoint), {});
	t.match(text, /^Usage: thing\b/, 'usage line falls back to the unscoped package name when no bin matches');

	t.end();
});

test('getHelpText - falls back to basename when no package.json is found', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	// a nested dir whose ancestors (within the temp tree) have no package.json
	const nested = join(testDir, 'a', 'b');
	mkdirSync(nested, { recursive: true });
	const entrypoint = join(nested, 'cli.mjs');
	await writeFile(entrypoint, '// test file');

	const text = await getHelpText(realpathSync(entrypoint), {});
	t.match(text, /^Usage: cli\.mjs\b/, 'usage line falls back to the file basename');

	t.end();
});

test('getHelpText - non-matching bin entries fall back to the package name', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'bin.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'other.mjs'), '// test file'),
		writeFile(join(testDir, 'package.json'), JSON.stringify({
			name: 'thing',
			bin: { missing: './nope.mjs', other: './other.mjs' },
		})),
	]);

	const text = await getHelpText(realpathSync(entrypoint), {});
	t.match(text, /^Usage: thing\b/, 'broken or non-matching bin entries are skipped, falling back to the name');

	t.end();
});

test('getHelpText - package.json without a name falls back to basename', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'cli.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'package.json'), '{}'),
	]);

	const text = await getHelpText(realpathSync(entrypoint), {});
	t.match(text, /^Usage: cli\.mjs\b/, 'falls back to basename when the nearest package.json has no name');

	t.end();
});

test('getHelpText - rethrows non-ENOENT errors', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');
	mkdirSync(join(testDir, 'help.txt')); // a directory where a file is expected

	try {
		await getHelpText(entrypoint, {});
		t.fail('should have thrown');
	} catch (e) {
		t.ok(e instanceof Error, 'rethrows the read error');
		t.notEqual(e && typeof e === 'object' && 'code' in e && e.code, 'ENOENT', 'error is not ENOENT');
	}

	t.end();
});

test('pargs - generated help when help.txt is absent', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');
	await writeFile(entrypoint, '// test file'); // intentionally no help.txt

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--help'] });
	const result = await pargs(entrypoint, {
		options: {
			verbose: { type: 'boolean', description: 'Enable verbose output' },
		},
	});

	const logCapture = t.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
	t.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
		throw new Error('EXIT');
	});

	try {
		await result.help();
	} catch (e) {
		t.ok(e instanceof Error, 'process.exit mock throws');
	}

	const logs = logCapture().map((call) => call.args.join(' '));
	t.ok(logs.some((log) => log.includes('Usage: test.mjs')), 'generated usage line is printed');
	t.ok(logs.some((log) => log.includes('Enable verbose output')), 'generated option description is printed');

	t.end();
});

test('pargs - generated help on error path when help.txt is absent', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');
	await writeFile(entrypoint, '// test file'); // intentionally no help.txt

	t.intercept(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'argv', { value: [process.execPath, entrypoint, '--verbose=nope'] });
	const result = await pargs(entrypoint, {
		options: {
			verbose: { type: 'boolean' },
		},
	});

	t.ok(result.errors.length > 0, 'has errors from the parseArgs failure');

	const logCapture = t.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'log');
	const errorCapture = t.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console)), 'error');
	t.capture(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process)), 'exit', () => {
		throw new Error('EXIT');
	});

	const originalExitCode = process.exitCode;
	try {
		await result.help();
	} catch (e) {
		t.ok(e instanceof Error, 'process.exit mock throws');
	}
	const logs = logCapture().map((call) => call.args.join(' '));
	const errors = errorCapture().map((call) => call.args.join(' '));
	process.exitCode = originalExitCode;

	t.ok(logs.some((log) => log.includes('Usage: test.mjs')), 'generated help is printed on the error path');
	t.ok(errors.length > 0, 'errors are printed to stderr');

	t.end();
});
