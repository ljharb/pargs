import test from 'tape';
import { writeFile } from 'fs/promises';
import { rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import tmp from 'tmp';

import pargs from '../index.mjs';

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

		const errors = errorCapture().map((call) => call.args.join(' '));
		const exitCalls = exitCapture();
		const capturedExitCode = process.exitCode;

		process.exitCode = originalExitCode;

		st.equal(exitCalls.length, 1, 'help() with errors calls process.exit');
		st.ok(errors.length > 0, 'console.error was called');
		st.ok(errors.some((err) => err.includes('This is help text')), 'help text was output to console.error');
		st.ok(errors.some((err) => err.includes('Unknown option')), 'help() outputs errors to console.error');
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
