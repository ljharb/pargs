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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--version'] });
	const result = await pargs(entrypoint, {
		options: { version: { type: 'boolean' } },
	});
	t.ok(result.values.version, 'the user-defined version option still parses');

	const logCapture = t.capture(console, 'log');
	t.capture(process, 'exit', () => {
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--version'] });
	const result = await pargs(entrypoint, {
		options: { verbose: { type: 'boolean' } },
	});

	t.ok(result.values.version, '--version flag is set');

	const logCapture = t.capture(console, 'log');
	t.capture(process, 'exit', () => {
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

test('pargs - `version` config', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'package.json'), JSON.stringify({ version: '4.5.6' })),
	]);

	/** @type {(st: import('tape').Test, result: { help: () => Promise<void> }) => Promise<string[]>} */
	async function printed(st, result) {
		const logCapture = st.capture(console, 'log');
		st.capture(process, 'exit', () => {
			throw new Error('EXIT');
		});
		try {
			await result.help();
		} catch { /**/ }
		// tape writes its own TAP through `console.log`, so every assertion made
		// after this returns would have its `ok`/`not ok` line swallowed while the
		// capture is still in place
		logCapture.restore?.();
		return logCapture().map((call) => call.args.join(' '));
	}

	t.test('`version: true` matches the default', async (st) => {
		const result = await pargs(entrypoint, { args: ['--version'], version: true });
		const logs = await printed(st, result);
		st.deepEqual(logs, ['v4.5.6'], 'prints the prefixed package version');
	});

	t.test('an inherited `version` yields to a subcommand\'s own `version` option', async (st) => {
		// the root wrote `version`, the subcommand wrote the option: the two were not
		// declared in one place, so the option wins rather than the config throwing
		const config = {
			version: 'mytool 1.2.3',
			subcommands: {
				ls: {},
				print: { options: { version: { type: /** @type {'string'} */ ('string') } } },
			},
		};

		const routed = await pargs(entrypoint, { ...config, args: ['print', '--version', '3'] });
		st.deepEqual(routed.errors, [], 'the subcommand parses');
		st.equal(routed.command.values.version, '3', 'its own option owns `--version`');

		const sibling = await pargs(entrypoint, { ...config, args: ['ls'] });
		st.deepEqual(sibling.errors, [], 'a sibling without one is unaffected');

		// but writing both at the same level is still a contradiction
		try {
			await pargs(entrypoint, {
				args: ['print'],
				subcommands: { print: { version: 'x', options: { version: { type: /** @type {'string'} */ ('string') } } } },
			});
			st.fail('should have thrown');
		} catch (e) {
			st.match(/** @type {Error} */ (e).message, /not allowed when a .version. option/, 'a same-level clash still throws');
		}
	});

	t.test('a string `version` is printed verbatim', async (st) => {
		const result = await pargs(entrypoint, { args: ['--version'], version: '4.5.6' });
		const logs = await printed(st, result);
		st.deepEqual(logs, ['4.5.6'], 'no `v` prefix, and no `package.json` lookup');
	});

	t.test('`version: false` drops the option', async (st) => {
		const result = await pargs(entrypoint, { args: ['--version'], version: false });
		st.deepEqual(result.errors, ["Error: Unknown option '--version'"], '`--version` is unknown');
		st.equal('version' in result.values, false, 'no `version` key in `values`');
	});

	t.test('`version: false` omits the help row', (st) => {
		const help = generateHelp('cli', { version: false, options: { verbose: { type: 'boolean' } } });
		st.doesNotMatch(help, /--version/, 'no `--version` row is generated');
		st.match(help, /--help/, 'the `--help` row is still generated');
		st.end();
	});

	t.test('a non-boolean, non-string `version` throws', async (st) => {
		try {
			// @ts-expect-error
			await pargs(entrypoint, { version: 1 });
			st.fail('should have thrown');
		} catch (e) {
			st.ok(e instanceof TypeError, 'throws a TypeError');
			st.match(/** @type {Error} */ (e).message, /`version`/, 'the message mentions `version`');
		}
	});

	t.test('`version` alongside a user-declared `version` option throws', async (st) => {
		try {
			await pargs(entrypoint, {
				version: '1.2.3',
				options: { version: { type: 'boolean' } },
			});
			st.fail('should have thrown');
		} catch (e) {
			st.ok(e instanceof TypeError, 'throws a TypeError');
			st.match(/** @type {Error} */ (e).message, /not allowed/, 'the message explains the conflict');
		}
	});

	t.test('a routed `defaultCommand` uses its own `version`', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['--version'],
			defaultCommand: 'build',
			subcommands: {
				build: { version: 'from-the-subcommand' },
			},
		});
		const logs = await printed(st, result);
		st.deepEqual(logs, ['from-the-subcommand'], 'the level that parsed the flag decides');
	});

	// `st.capture` swallows the TAP output of anything asserted while it is active,
	// and leaves `process.exitCode` set, which suppresses tape's own summary
	/** @type {(config: Record<string, unknown>) => Promise<{ out: string[], returned: boolean }>} */
	async function handled(config) {
		const result = await pargs(entrypoint, config);
		/** @type {string[]} */
		const out = [];
		const realLog = console.log;
		const realError = console.error;
		const realExit = process.exit;
		const realExitCode = process.exitCode;
		console.log = (...args) => { out.push(args.join(' ')); };
		console.error = () => {};
		process.exit = () => {
			throw new Error('EXIT');
		};
		let returned = false;
		try {
			await result.help();
			returned = true;
		} catch { /**/ } finally {
			console.log = realLog;
			console.error = realError;
			process.exit = realExit;
			process.exitCode = realExitCode;
		}
		return { out, returned };
	}

	t.test('subcommands inherit the root `version`', async (st) => {
		const routedOff = await pargs(entrypoint, {
			args: ['--version'],
			version: false,
			defaultCommand: 'build',
			subcommands: { build: {} },
		});
		st.deepEqual(
			routedOff.command.errors,
			["Error: Unknown option '--version'"],
			'`version: false` reaches a routed `defaultCommand`',
		);

		const routedString = await handled({
			args: ['--version'],
			version: 'custom-1.2.3',
			defaultCommand: 'build',
			subcommands: { build: {} },
		});
		st.deepEqual(routedString.out, ['custom-1.2.3'], 'a string reaches a routed `defaultCommand`');

		const named = await pargs(entrypoint, {
			args: ['run', '--version'],
			version: false,
			subcommands: { run: {} },
		});
		st.deepEqual(
			named.command.errors,
			["Error: Unknown option '--version'"],
			'`version: false` reaches a named subcommand',
		);
	});

	t.test('a subcommand overrides what it inherited', async (st) => {
		const result = await handled({
			args: ['run', '--version'],
			version: 'from-the-root',
			subcommands: { run: { version: 'from-the-subcommand' } },
		});
		st.deepEqual(result.out, ['from-the-subcommand'], 'the subcommand wins');
	});

	t.test('a user-declared `version` option is honored through a `defaultCommand`', async (st) => {
		// regression guard: pargs must not print a version the caller owns, no
		// matter which level ended up parsing the flag
		const result = await handled({
			args: ['--version'],
			options: { version: { type: 'boolean' } },
			defaultCommand: 'build',
			subcommands: { build: {} },
		});
		st.deepEqual(result.out, [], 'pargs prints nothing');
		st.equal(result.returned, true, 'and does not exit, so the caller can print it');
	});

	t.test('an explicitly `undefined` `version` is treated as absent', async (st) => {
		const result = await pargs(entrypoint, { args: [], version: undefined });
		st.equal(result.values.version, false, 'the built-in option is still registered');
	});

	t.test('a user-declared `version` option leaves `values` usable', async (st) => {
		// also a compile-time guard: if `ReservedValues` starts intersecting
		// `{ version: boolean }` on top of the declared option again, `values`
		// reduces to `never` and these reads stop type-checking
		const result = await pargs(entrypoint, {
			args: ['--version', 'v9', '--other'],
			options: {
				version: { type: 'string' },
				other: { type: 'boolean' },
			},
		});
		st.equal(result.values.version, 'v9', 'the declared option parses');
		st.equal(result.values.other, true, 'and so does everything alongside it');
	});
});

test('pargs - `shorts`', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');
	await Promise.all([
		writeFile(entrypoint, '// test file'),
		writeFile(join(testDir, 'package.json'), JSON.stringify({ version: '4.5.6' })),
	]);

	/** @type {(st: import('tape').Test, config: Record<string, unknown>, re: RegExp, msg: string) => Promise<void>} */
	async function rejects(st, config, re, msg) {
		try {
			await pargs(entrypoint, /** @type {never} */ (config));
			st.fail(`should have thrown: ${msg}`);
		} catch (e) {
			st.ok(e instanceof TypeError, `${msg}: throws a TypeError`);
			st.match(/** @type {Error} */ (e).message, re, msg);
		}
	}

	t.test('registers `-h` and `-V`', async (st) => {
		const help = await pargs(entrypoint, { args: ['-h'], shorts: true });
		st.equal(help.values.help, true, '`-h` sets help');
		st.deepEqual(help.errors, [], 'no errors');

		const version = await pargs(entrypoint, { args: ['-V'], shorts: true });
		st.equal(version.values.version, true, '`-V` sets version');
		st.deepEqual(version.errors, [], 'no errors');
	});

	t.test('`-v` and `-V` coexist', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['-v', '1.2.3', '-V'],
			shorts: true,
			options: { 'latest-version': { type: 'string', short: 'v' } },
		});
		st.equal(result.values['latest-version'], '1.2.3', 'the lowercase short is the user option');
		st.equal(result.values.version, true, 'the uppercase short is the built-in version');
		st.deepEqual(result.errors, [], 'no errors');
	});

	t.test('`shorts: true` yields to an option that claims the letter', async (st) => {
		const config = {
			args: ['-h', 'HOST'],
			shorts: /** @type {true} */ (true),
			options: { host: { type: /** @type {'string'} */ ('string'), short: 'h' } },
		};
		const result = await pargs(entrypoint, config);
		st.equal(result.values.host, 'HOST', '`-h` still belongs to the option');
		st.deepEqual(result.errors, [], 'no errors');

		const help = generateHelp('cli', config);
		st.doesNotMatch(help, /-h, --help/, 'the generated help does not claim `-h` either');
		st.match(help, /-h, --host/, 'the option keeps `-h` in the help');
	});

	t.test('`generateHelp` renders the reserved shorts', (st) => {
		const help = generateHelp('cli', { shorts: true, options: { verbose: { type: 'boolean' } } });
		st.match(help, /-h, --help/, '`-h` is shown on the help row');
		st.match(help, /-V, --version/, '`-V` is shown on the version row');
		st.end();
	});

	t.test('a routed `defaultCommand` keeps its own letter, and the usage still renders', async (st) => {
		// the root asked for `-h` and the subcommand claims it for `--host`; the two
		// were not written in one place, so the collision yields rather than throwing -
		// and it has to yield at render time too, not only while parsing
		const config = {
			shorts: { help: /** @type {'h'} */ ('h') },
			defaultCommand: 'run',
			subcommands: { run: { options: { host: { type: /** @type {'string'} */ ('string'), short: 'h' } } } },
		};

		const result = await pargs(entrypoint, { ...config, args: ['--help'] });
		st.deepEqual(result.errors, [], 'the config parses');

		st.doesNotThrow(
			() => generateHelp('cli', config),
			'rendering the usage does not throw',
		);
		st.doesNotMatch(generateHelp('cli', config), /-h, --help/, 'the usage does not claim `-h` for help');
	});

	t.test('an explicitly `undefined` request is absent, not invalid', async (st) => {
		// spreading an optional field must not be a startup error - the same rule
		// `version` and the option configs already follow
		const config = { shorts: { help: undefined, version: undefined } };
		const result = await pargs(entrypoint, { ...config, args: [] });
		st.deepEqual(result.errors, [], 'the config is accepted');

		const help = generateHelp('cli', config);
		st.doesNotMatch(help, /-h, --help/, 'and no short is registered for help');
		st.doesNotMatch(help, /-V, --version/, 'nor for version');
	});

	t.test('an explicitly requested letter that collides throws', async (st) => {
		await rejects(
			st,
			{ shorts: { help: 'h' }, options: { host: { type: 'string', short: 'h' } } },
			/already uses/,
			'an explicit collision is a config error',
		);
	});

	t.test('`shorts: false` and an absent `shorts` register nothing', async (st) => {
		const off = await pargs(entrypoint, { args: ['-h'], shorts: false });
		st.equal(off.errors.length, 1, '`-h` is unknown with `shorts: false`');

		const absent = await pargs(entrypoint, { args: ['-h'] });
		st.equal(absent.errors.length, 1, '`-h` is unknown by default');
	});

	t.test('`version: false` skips `-V` under `shorts: true`', async (st) => {
		const result = await pargs(entrypoint, { args: ['-h'], shorts: true, version: false });
		st.equal(result.values.help, true, '`-h` still registers');

		const missing = await pargs(entrypoint, { args: ['-V'], shorts: true, version: false });
		st.equal(missing.errors.length, 1, '`-V` is not registered');
	});

	t.test('invalid configurations throw', async (st) => {
		await rejects(st, { shorts: [] }, /must be a boolean, or an object/, 'an array is rejected');
		await rejects(st, { shorts: 'h' }, /must be a boolean, or an object/, 'a string is rejected');
		await rejects(st, { shorts: { nope: 'n' } }, /may only contain/, 'an unknown key is rejected');
		await rejects(st, { shorts: { help: 'hh' } }, /single character/, 'a multi-character letter is rejected');
		await rejects(st, { shorts: { help: '\u{1F600}' } }, /single character/, 'an astral character is rejected');
		await rejects(st, { shorts: { help: 'x', version: 'x' } }, /both request/, 'two shorts on one letter is rejected');
		await rejects(
			st,
			{ shorts: { version: 'V' }, options: { version: { type: 'boolean' } } },
			/no built-in `--version`/,
			'`shorts.version` with a user-declared version option is rejected',
		);
		await rejects(
			st,
			{ shorts: { version: 'V' }, version: false },
			/no built-in `--version`/,
			'`shorts.version` with `version: false` is rejected',
		);
	});

	t.test('subcommands inherit `shorts`', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['build', '-h'],
			shorts: true,
			subcommands: { build: { options: { verbose: { type: 'boolean' } } } },
		});
		st.equal(result.command.values.help, true, 'the subcommand registers `-h` too');
		st.deepEqual(result.command.errors, [], 'no errors');
	});

	t.test('a subcommand can override the inherited `shorts`', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['build', '-h'],
			shorts: true,
			subcommands: { build: { shorts: false } },
		});
		st.equal(result.command.errors.length, 1, '`-h` is unknown in the subcommand');
	});

	t.test('an inherited explicit letter yields rather than throwing', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['build', '-h', 'HOST'],
			shorts: { help: 'h' },
			subcommands: { build: { options: { host: { type: 'string', short: 'h' } } } },
		});
		st.equal(result.command.values.host, 'HOST', 'the subcommand option keeps the letter');
		st.deepEqual(result.command.errors, [], 'the inherited request is skipped, not an error');
	});

	t.test('a routed `defaultCommand` inherits `shorts`', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['-h'],
			shorts: true,
			defaultCommand: 'build',
			subcommands: { build: { options: { verbose: { type: 'boolean' } } } },
		});
		st.equal(result.command.values.help, true, 'the default command registers `-h`');
	});

	t.test('an inherited explicit `shorts.version` yields where there is no built-in `--version`', async (st) => {
		const optedOut = await pargs(entrypoint, {
			args: ['run'],
			shorts: { version: 'V' },
			subcommands: { run: { version: false } },
		});
		st.deepEqual(optedOut.command.errors, [], 'a subcommand with `version: false` does not throw');

		const ownOption = await pargs(entrypoint, {
			args: ['run'],
			shorts: { version: 'V' },
			subcommands: { run: { options: { version: { type: 'boolean' } } } },
		});
		st.deepEqual(ownOption.command.errors, [], 'nor does one that declares its own `version` option');
	});

	t.test('a subcommand`s own explicit `shorts` still throws on its own collision', async (st) => {
		// the root mentioning `shorts` must not silence a collision the subcommand
		// wrote in one place
		try {
			await pargs(entrypoint, {
				args: ['run'],
				shorts: true,
				subcommands: {
					run: {
						shorts: { help: 'h' },
						options: { host: { type: 'string', short: 'h' } },
					},
				},
			});
			st.fail('should have thrown');
		} catch (e) {
			st.match(/** @type {Error} */ (e).message, /already uses/, 'the collision is reported');
		}
	});

	t.test('the root usage does not advertise a short the `defaultCommand` owns', (st) => {
		const config = {
			shorts: /** @type {true} */ (true),
			defaultCommand: 'build',
			subcommands: {
				build: { options: { host: { type: /** @type {'string'} */ ('string'), short: 'h' } } },
			},
		};
		const help = generateHelp('cli', config);
		st.doesNotMatch(help, /-h, --help/, '`-h` is not claimed for `--help`');
		st.match(help, /--help/, 'the long form is still listed');
		st.end();
	});

	t.test('`-h` really does reach the `defaultCommand`s option', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['-h', 'example.com'],
			shorts: true,
			defaultCommand: 'build',
			subcommands: {
				build: { options: { host: { type: 'string', short: 'h' } } },
			},
		});
		st.equal(result.command.values.host, 'example.com', 'the option keeps the letter');
		st.equal(result.command.values.help, false, '`--help` was not triggered');
	});
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
	t.intercept(process, 'argv', { value: [process.execPath, filename] });

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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--verbose', '--no-verbose'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--help', '--no-help'] });
		const result = await pargs(entrypoint, {
			options: {
				debug: { type: 'boolean' },
			},
		});
		st.ok(result.errors.length > 0, 'has errors when both --help and --no-help are provided');
	});

	t.test('--no-flag works correctly', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--no-verbose'] });
		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean', default: true },
			},
		});
		st.equal(result.values.verbose, false, '--no-verbose sets value to false');
		st.notOk('no-verbose' in result.values, 'no-verbose is removed from values');
	});
});

test('pargs - `negation`', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');

	await writeFile(entrypoint, '// test file');

	t.test('the default is still exclusive', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['--verbose', '--no-verbose'],
			options: { verbose: { type: 'boolean' } },
		});
		st.deepEqual(
			result.errors,
			['Error: Arguments `--verbose` and `--no-verbose` are mutually exclusive'],
			'both forms together is an error by default',
		);
	});

	t.test('root `last-wins` keeps the last occurrence', async (st) => {
		const positive = await pargs(entrypoint, {
			args: ['--no-verbose', '--verbose'],
			negation: 'last-wins',
			options: { verbose: { type: 'boolean' } },
		});
		st.deepEqual(positive.errors, [], 'no error');
		st.equal(positive.values.verbose, true, '`--verbose` last wins');

		const negative = await pargs(entrypoint, {
			args: ['--verbose', '--no-verbose'],
			negation: 'last-wins',
			options: { verbose: { type: 'boolean' } },
		});
		st.deepEqual(negative.errors, [], 'no error');
		st.equal(negative.values.verbose, false, '`--no-verbose` last wins');
	});

	t.test('root `last-wins` covers the short form', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['-v', '--no-verbose'],
			negation: 'last-wins',
			options: { verbose: { type: 'boolean', short: 'v' } },
		});
		st.deepEqual(result.errors, [], 'no error');
		st.equal(result.values.verbose, false, '`--no-verbose` last wins over `-v`');
	});

	t.test('a per-option `negation` overrides the root', async (st) => {
		const exclusive = await pargs(entrypoint, {
			args: ['--verbose', '--no-verbose', '--debug', '--no-debug'],
			negation: 'last-wins',
			options: {
				verbose: { type: 'boolean' },
				debug: { type: 'boolean', negation: 'exclusive' },
			},
		});
		st.deepEqual(
			exclusive.errors,
			['Error: Arguments `--debug` and `--no-debug` are mutually exclusive'],
			'only the option that opted back in errors',
		);

		const lastWins = await pargs(entrypoint, {
			args: ['--verbose', '--no-verbose', '--debug', '--no-debug'],
			options: {
				verbose: { type: 'boolean' },
				debug: { type: 'boolean', negation: 'last-wins' },
			},
		});
		st.deepEqual(
			lastWins.errors,
			['Error: Arguments `--verbose` and `--no-verbose` are mutually exclusive'],
			'only the option that did not opt out errors',
		);
	});

	t.test('a per-option `undefined` inherits the root', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['--verbose', '--no-verbose'],
			negation: 'last-wins',
			options: { verbose: { type: 'boolean', negation: undefined } },
		});
		st.deepEqual(result.errors, [], 'the root policy applies');
	});

	t.test('the reserved options are unaffected', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['--help', '--no-help'],
			negation: 'last-wins',
			options: { verbose: { type: 'boolean' } },
		});
		st.deepEqual(result.errors, ['Error: Unknown option(s): `no-help`'], '`--no-help` is still unknown');
	});

	t.test('an invalid root value throws', async (st) => {
		try {
			// @ts-expect-error
			await pargs(entrypoint, { negation: 'nope' });
			st.fail('should have thrown');
		} catch (e) {
			st.ok(e instanceof TypeError, 'throws a TypeError');
			st.match(/** @type {Error} */ (e).message, /`negation`/, 'the message mentions `negation`');
		}
	});

	t.test('an invalid per-option value throws', async (st) => {
		try {
			await pargs(entrypoint, {
				// @ts-expect-error
				options: { verbose: { type: 'boolean', negation: 'nope' } },
			});
			st.fail('should have thrown');
		} catch (e) {
			st.ok(e instanceof TypeError, 'throws a TypeError');
			st.match(/** @type {Error} */ (e).message, /`verbose` is invalid/, 'the message names the option');
		}
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--unknown'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--foo', '--bar'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'build', '--verbose'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'unknown'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'build', '--unknown'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'some-input', '--json'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--json'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'other', '--verbose'] });
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

	const config = /** @type {import('../types.d.mts').PargsRootConfig} */ ({
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--help'] });
		const result = await pargs(entrypoint, config);

		const logCapture = st.capture(console, 'log');
		st.capture(process, 'exit', () => {
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--version'] });
		const result = await pargs(entrypoint, config);

		const logCapture = st.capture(console, 'log');
		st.capture(process, 'exit', () => {
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js', 'file3.js'] });
		const result = await pargs(entrypoint, {
			allowPositionals: true,
		});
		st.equal(result.positionals.length, 3, 'parses all positionals when allowPositionals is true');
		st.equal(result.errors.length, 0, 'no errors when positionals are allowed');
	});

	t.test('allowPositionals as number', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js'] });
		const result = await pargs(entrypoint, {
			allowPositionals: 2,
		});
		st.equal(result.positionals.length, 2, 'parses positionals when within limit');
		st.equal(result.errors.length, 0, 'no errors when positional count is within limit');
	});

	t.test('too many positionals', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js', 'file3.js'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'build', 'file1.js'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'file1.js'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js', 'file3.js'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'file1.js', 'file2.js'] });
		const result = await pargs(entrypoint, {
			allowPositionals: true,
			minPositionals: 2,
		});
		st.equal(result.positionals.length, 2, 'parses exactly minimum number of positionals');
		st.equal(result.errors.length, 0, 'no errors when minimum positionals provided');
	});

	t.test('minPositionals in subcommand', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'build', 'file1.js'] });
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

		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'build', 'file1.js', 'file2.js', 'file3.js'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--help'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--level=debug'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--level=invalid'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
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

test('pargs - enum validation only applies to provided values', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');

	await writeFile(entrypoint, '// test file');

	t.test('unprovided enum with no default', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info'],
				},
			},
		});
		st.deepEqual(result.errors, [], 'no errors when the option is absent');
		st.equal('level' in result.values, false, 'the key is absent from `values`');
	});

	t.test('unprovided `multiple` enum with no default', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info'],
					multiple: true,
				},
			},
		});
		st.deepEqual(result.errors, [], 'no errors when the option is absent');
		st.equal('level' in result.values, false, 'the key is absent from `values`');
	});

	t.test('`multiple` enum with all valid values', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--level=debug', '--level=info'] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info'],
					multiple: true,
				},
			},
		});
		st.deepEqual(result.values.level, ['debug', 'info'], 'collects every value');
		st.deepEqual(result.errors, [], 'no errors when every element is a valid choice');
	});

	t.test('`multiple` enum with one invalid value', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--level=debug', '--level=nope'] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info'],
					multiple: true,
				},
			},
		});
		st.deepEqual(result.errors, ['Error: Invalid value for option "level"'], 'one error when any element is an invalid choice');
	});

	t.test('`multiple` enum with a default', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info'],
					multiple: true,
					default: ['info'],
				},
			},
		});
		st.deepEqual(result.values.level, ['info'], 'uses the default');
		st.deepEqual(result.errors, [], 'no errors for a valid default');
	});

	t.test('`multiple` enum with an empty default', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info'],
					multiple: true,
					default: /** @type {string[]} */ ([]),
				},
			},
		});
		st.deepEqual(result.values.level, [], 'uses the empty default');
		st.deepEqual(result.errors, [], 'no errors for an empty default');
	});

	t.test('a default outside `choices` still errors', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				level: {
					type: 'enum',
					choices: ['debug', 'info'],
					default: 'nope',
				},
			},
		});
		st.deepEqual(result.errors, ['Error: Invalid value for option "level"'], 'a provided (defaulted) value is still validated');
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--port=8080'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--offset=-3.5'] });
		const result = await pargs(entrypoint, {
			options: {
				offset: { type: 'number' },
			},
		});
		st.equal(result.values.offset, -3.5, 'parses negative float');
		st.equal(result.errors.length, 0, 'no errors for negative number');
	});

	t.test('invalid number value', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--port=abc'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--port=Infinity'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number', default: 3e3 },
			},
		});
		st.equal(result.values.port, 3000, 'coerces default value to number');
		st.equal(result.errors.length, 0, 'no errors with default');
	});

	t.test('number with numeric default (not provided)', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number', default: 3e3 },
			},
		});
		st.equal(result.values.port, 3e3, 'coerces numeric default value to number');
		st.equal(result.errors.length, 0, 'no errors with numeric default');
	});

	t.test('number with multiple and numeric defaults (not provided)', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number', multiple: true, default: [80, 443] },
			},
		});
		st.deepEqual(result.values.port, [80, 443], 'coerces numeric array defaults to numbers');
		st.equal(result.errors.length, 0, 'no errors with numeric array defaults');
	});

	t.test('number not provided without default', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number' },
			},
		});
		st.notOk('port' in result.values, 'port is absent when not provided and no default');
		st.equal(result.errors.length, 0, 'no errors when an optional number is omitted');
	});

	t.test('number with multiple', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--port=80', '--port=443'] });
		const result = await pargs(entrypoint, {
			options: {
				port: { type: 'number', multiple: true },
			},
		});
		st.deepEqual(result.values.port, [80, 443], 'parses multiple number values');
		st.equal(result.errors.length, 0, 'no errors for valid multiple numbers');
	});

	t.test('number with multiple, one invalid', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--port=80', '--port=abc'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--count=42'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--count=3.14'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--count=abc'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--count=-5'] });
		const result = await pargs(entrypoint, {
			options: {
				count: { type: 'integer' },
			},
		});
		st.equal(result.values.count, -5, 'parses negative integer');
		st.equal(result.errors.length, 0, 'no errors for negative integer');
	});

	t.test('integer with multiple', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--id=1', '--id=2', '--id=3'] });
		const result = await pargs(entrypoint, {
			options: {
				id: { type: 'integer', multiple: true },
			},
		});
		st.deepEqual(result.values.id, [1, 2, 3], 'parses multiple integer values');
		st.equal(result.errors.length, 0, 'no errors for valid multiple integers');
	});

	t.test('integer with multiple, one float', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--id=1', '--id=2.5'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--help'] });
		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean' },
			},
		});

		st.equal(typeof result.help, 'function', 'result has help function');

		const logCapture = st.capture(console, 'log');
		const exitCapture = st.capture(process, 'exit', () => {
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--unknown'] });
		const result = await pargs(entrypoint, {
			options: {
				verbose: { type: 'boolean' },
			},
		});

		st.ok(result.errors.length > 0, 'result has errors before calling help');
		st.equal(typeof result.help, 'function', 'result has help function');
		st.notOk(result.values.help, '--help flag should not be set');

		const logCapture = st.capture(console, 'log');
		const errorCapture = st.capture(console, 'error');
		const exitCapture = st.capture(process, 'exit', () => {
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--flag', 'value'] });
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

test('pargs - `args`', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');

	await writeFile(entrypoint, '// test file');

	t.test('an explicit `args` beats `process.argv`', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--flag', 'FROM_ARGV'] });
		const result = await pargs(entrypoint, {
			args: ['--flag', 'FROM_ARGS'],
			options: { flag: { type: 'string' } },
		});
		st.equal(result.values.flag, 'FROM_ARGS', 'the provided `args` is used');
	});

	t.test('an empty `args` parses nothing', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--flag', 'FROM_ARGV'] });
		const result = await pargs(entrypoint, {
			args: [],
			options: { flag: { type: 'string' } },
		});
		st.equal('flag' in result.values, false, 'nothing is parsed');
	});

	t.test('an explicitly `undefined` `args` falls back to `process.argv`', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--flag', 'FROM_ARGV'] });
		const result = await pargs(entrypoint, {
			args: undefined,
			options: { flag: { type: 'string' } },
		});
		st.equal(result.values.flag, 'FROM_ARGV', '`process.argv` is used');
	});

	t.test('an explicit `args` is not filtered', async (st) => {
		const result = await pargs(entrypoint, {
			args: [process.execPath, entrypoint],
			allowPositionals: true,
		});
		st.deepEqual(result.positionals, [process.execPath, entrypoint], 'the node binary and the entrypoint survive');
	});

	t.test('`args` governs subcommand routing, and `process.argv` is untouched', async (st) => {
		const argv = [process.execPath, entrypoint, 'build', '--verbose'];
		st.intercept(process, 'argv', { value: argv });
		const result = await pargs(entrypoint, {
			args: ['test', '--watch'],
			subcommands: {
				build: { options: { verbose: { type: 'boolean' } } },
				test: { options: { watch: { type: 'boolean' } } },
			},
		});
		st.equal(result.command.name, 'test', '`args` selects the subcommand');
		st.equal(/** @type {{ watch?: boolean }} */ (result.command.values).watch, true, 'the subcommand parses its own options');
		st.deepEqual(process.argv, argv, '`process.argv` is not spliced');
	});

	t.test('`args` routes to `defaultCommand`', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['--verbose'],
			defaultCommand: 'build',
			subcommands: {
				build: { options: { verbose: { type: 'boolean' } } },
			},
		});
		st.equal(result.command.name, 'build', 'routes to the default command');
		st.equal(result.command.values.verbose, true, 'the whole list is parsed against it');
	});

	// nested `subcommands` work at runtime, but `PargsConfig` does not declare them
	/** @typedef {{ command: { name: string, command: { name: string, values: { url?: string } } } }} NestedResult */
	/** @type {(config: Record<string, unknown>) => Promise<NestedResult>} */
	// @ts-expect-error nested `subcommands` are not declarable, per the note above
	const parseNested = (config) => pargs(entrypoint, config);

	const nested = {
		remote: {
			subcommands: {
				add: { options: { url: { type: 'string' } } },
			},
		},
	};

	t.test('`args` routes through nested subcommands', async (st) => {
		// written inline and uncast, so the reads below are a compile-time check
		// that a nested config is expressible and its result typed all the way down
		const result = await pargs(entrypoint, {
			args: ['remote', 'add', '--url', 'U'],
			subcommands: {
				remote: {
					subcommands: {
						add: { options: { url: { type: 'string' } } },
					},
				},
			},
		});
		st.equal(result.command.name, 'remote', 'the outer subcommand is selected');
		st.equal(result.command.command.name, 'add', 'the inner subcommand is selected');
		st.equal(result.command.command.values.url, 'U', 'the leaf parses its own options');
	});

	t.test('nested subcommands still splice `process.argv` when no `args` is given', async (st) => {
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'remote', 'add', '--url', 'U'] });
		const result = await parseNested({ subcommands: nested });
		st.equal(result.command.command.values.url, 'U', 'the leaf still parses its own options');
		st.deepEqual(process.argv, [process.execPath, entrypoint, '--url', 'U'], 'every subcommand name is spliced out');
	});

	t.test('a non-array `args` throws', async (st) => {
		try {
			// @ts-expect-error
			await pargs(entrypoint, { args: 'nope' });
			st.fail('should have thrown');
		} catch (e) {
			st.ok(e instanceof TypeError, 'throws a TypeError');
			st.match(/** @type {Error} */ (e).message, /`args`/, 'the message mentions `args`');
		}
	});

	t.test('the reserved `help` check comes first', async (st) => {
		try {
			await pargs(entrypoint, {
				// @ts-expect-error
				args: 'nope',
				options: { help: { type: 'boolean' } },
			});
			st.fail('should have thrown');
		} catch (e) {
			st.match(/** @type {Error} */ (e).message, /help.*reserved/i, 'the reserved-help error wins');
		}
	});
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--verbose=yes'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--level=invalid'] });
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

		const logCapture = st.capture(console, 'log');
		const errorCapture = st.capture(console, 'error');
		const exitCapture = st.capture(process, 'exit', () => {
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

test('pargs - `partialValues`', async (t) => {
	const { name: testDir, removeCallback } = tmp.dirSync();
	t.teardown(emptyFirst(testDir, removeCallback));

	const entrypoint = join(testDir, 'test.mjs');

	await writeFile(entrypoint, '// test file');

	t.test('without the flag, everything is discarded', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['pos', '--nope', '-o', 'OUT.md'],
			allowPositionals: true,
			options: { output: { type: 'string', short: 'o' } },
		});
		st.deepEqual(result.values, {}, '`values` is empty');
		st.deepEqual(result.positionals, [], '`positionals` is empty');
		st.equal(result.errors.length, 1, 'the fatal error is reported');
	});

	t.test('salvages the options that parsed cleanly', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['--nope', '-o', 'OUT.md'],
			partialValues: true,
			options: { output: { type: 'string', short: 'o' } },
		});
		st.deepEqual(result.values, { output: 'OUT.md', help: false, version: false }, 'the good option survives');
		st.deepEqual(result.errors, ["Error: Unknown option '--nope'"], 'only the fatal error is reported');
	});

	t.test('keeps positionals', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['pos', '--nope'],
			partialValues: true,
			allowPositionals: true,
		});
		st.deepEqual(result.positionals, ['pos'], 'positionals come from the loose reparse');
	});

	t.test('drops values that contradict the declared type', async (st) => {
		const boolWithString = await pargs(entrypoint, {
			args: ['--verbose=x'],
			partialValues: true,
			options: { verbose: { type: 'boolean' } },
		});
		st.equal('verbose' in boolWithString.values, false, 'a string on a boolean is dropped');

		const stringWithoutValue = await pargs(entrypoint, {
			args: ['-o'],
			partialValues: true,
			options: { output: { type: 'string', short: 'o' } },
		});
		st.equal('output' in stringWithoutValue.values, false, 'a valueless string option is dropped');
	});

	t.test('keeps `multiple` values', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['--tag', 'a', '--tag', 'b', '--nope'],
			partialValues: true,
			options: { tag: { type: 'string', multiple: true } },
		});
		st.deepEqual(result.values.tag, ['a', 'b'], 'every occurrence survives');
	});

	t.test('coerces numbers, and drops invalid ones', async (st) => {
		const good = await pargs(entrypoint, {
			args: ['--ratio', '1.5', '--nope'],
			partialValues: true,
			options: { ratio: { type: 'number' } },
		});
		st.equal(good.values.ratio, 1.5, 'a fractional number survives on `number`');

		const ports = await pargs(entrypoint, {
			args: ['--port', '80', '--port', '443', '--nope'],
			partialValues: true,
			options: { port: { type: 'number', multiple: true } },
		});
		st.deepEqual(ports.values.port, [80, 443], 'a `multiple` number is coerced element-wise');

		const badInteger = await pargs(entrypoint, {
			args: ['--count', '1.5', '--nope'],
			partialValues: true,
			options: { count: { type: 'integer' } },
		});
		st.equal('count' in badInteger.values, false, 'a fractional value is dropped on `integer`');

		const goodInteger = await pargs(entrypoint, {
			args: ['--count', '2', '--nope'],
			partialValues: true,
			options: { count: { type: 'integer' } },
		});
		st.equal(goodInteger.values.count, 2, 'a whole value survives on `integer`');
	});

	t.test('applies `enum` choices', async (st) => {
		const good = await pargs(entrypoint, {
			args: ['--level', 'debug', '--nope'],
			partialValues: true,
			options: { level: { type: 'enum', choices: ['debug', 'info'] } },
		});
		st.equal(good.values.level, 'debug', 'a valid choice survives');

		const bad = await pargs(entrypoint, {
			args: ['--level', 'nope', '--bogus'],
			partialValues: true,
			options: { level: { type: 'enum', choices: ['debug', 'info'] } },
		});
		st.equal('level' in bad.values, false, 'an invalid choice is dropped');
		st.equal(bad.errors.length, 1, 'only the fatal error is reported');
	});

	t.test('does not leak undeclared options', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['--no-thing', '--nope'],
			partialValues: true,
			options: { verbose: { type: 'boolean' } },
		});
		st.equal('thing' in result.values, false, 'a negated undeclared option is dropped');
	});

	t.test('keeps a declared negation', async (st) => {
		const result = await pargs(entrypoint, {
			args: ['--no-verbose', '--nope'],
			partialValues: true,
			options: { verbose: { type: 'boolean' } },
		});
		st.equal(result.values.verbose, false, '`--no-verbose` survives');
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'build'] });

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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--anything'] });
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--verbose'] });
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--verbose=yes'] });
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'unexpected-positional'] });
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, 'build', '--help'] });
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--help'] });

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

		const logCapture = st.capture(console, 'log');
		st.capture(process, 'exit', () => {
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--help'] });
		st.intercept(process.stdout, 'isTTY', { value: false });

		// Set up captures before any operations that might use them
		const logCapture = st.capture(console, 'log');
		st.capture(process, 'exit', () => {
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
		st.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--help'] });
		st.intercept(process.stdout, 'isTTY', { value: true });

		// Ensure NO_COLOR is not set
		const originalNoColor = process.env.NO_COLOR;
		delete process.env.NO_COLOR;
		st.teardown(() => {
			if (originalNoColor !== undefined) {
				process.env.NO_COLOR = originalNoColor;
			}
		});

		// Set up captures before any operations that might use them
		const logCapture = st.capture(console, 'log');
		st.capture(process, 'exit', () => {
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--help'] });
	const result = await pargs(entrypoint, {
		options: {
			verbose: { type: 'boolean', description: 'Enable verbose output' },
		},
	});

	const logCapture = t.capture(console, 'log');
	t.capture(process, 'exit', () => {
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

	t.intercept(process, 'argv', { value: [process.execPath, entrypoint, '--verbose=nope'] });
	const result = await pargs(entrypoint, {
		options: {
			verbose: { type: 'boolean' },
		},
	});

	t.ok(result.errors.length > 0, 'has errors from the parseArgs failure');

	const logCapture = t.capture(console, 'log');
	const errorCapture = t.capture(console, 'error');
	t.capture(process, 'exit', () => {
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
