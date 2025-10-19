import { parseArgs } from 'util';
import { dirname, join } from 'path';
import { realpathSync } from 'fs';
import { readFile } from 'fs/promises';

import isParseArgsError from './isParseArgsError.mjs';

const {
	hasOwn,
	fromEntries,
	groupBy,
	keys,
	entries,
} = Object;

const { from, isArray } = Array;

/** @typedef {import('./index.d.mts').OptionToken} OptionToken */
/** @typedef {import('./index.d.mts').PargsConfig} PargsConfig */
/** @typedef {import('./index.d.mts').PargsParsed} PargsParsed */
/** @typedef {import('./index.d.mts').ParseArgsConfig} ParseArgsConfig */

/** @type {import('./index.d.mts').default} */
export default async function pargs(entrypointPath, obj) {
	const realEntrypointPath = realpathSync(entrypointPath);
	const argv = process.argv.flatMap((arg) => {
		try {
			const realpathedArg = realpathSync(arg);
			if (
				realpathedArg === process.execPath
				|| realpathedArg === realEntrypointPath
			) {
				return [];
			}
		} catch (e) { /**/ }
		return arg;
	});

	if ('help' in obj || (obj.options && 'help' in obj.options)) {
		throw new TypeError('The "help" option is reserved');
	}

	/** @type {string[]} */
	const errors = [];

	if ('subcommands' in obj && (!obj.subcommands || typeof obj.subcommands !== 'object')) {
		throw new TypeError('Error: `subcommands` must be an object');
	}

	const { subcommands, ...passedConfig } = obj;

	if ('subcommands' in obj && keys(obj.subcommands).length === 0) {
		throw new TypeError('Error: `subcommands` must be an object with at least one key');
	}

	if ('subcommands' in obj && 'allowPositionals' in passedConfig) {
		throw new TypeError('Error: `allowPositionals` is not allowed when `subcommands` is defined');
	}

	const enums = { __proto__: null };

	/** @type {{ options: ParseArgsConfig['options'] & { help: { default: false, type: 'boolean' } } }} */
	const normalizedOptions = fromEntries(entries(passedConfig.options ?? {}).flatMap(([key, value]) => {
		if (value.type !== 'enum') {
			return [[key, value]];
		}

		if (!isArray(value.choices) || !value.choices.every((x) => typeof x === 'string')) {
			throw new TypeError(`Error: enum choices must be an array of strings; \`${key}\` is invalid`);
		}

		enums[key] = value;
		return [[key, { ...value, type: 'string' }]];
	}).concat([
		[
			'help',
			{
				default: false,
				type: 'boolean',
			},
		],
	]));

	/** @type {ParseArgsConfig & { tokens: true, allowNegative: true, strict: true, options: typeof normalizedOptions }} */
	const newObj = {
		args: subcommands ? argv.slice(0, 1) : argv,
		...passedConfig,
		options: normalizedOptions,
		tokens: true,
		allowNegative: true,
		allowPositionals: !!subcommands || typeof passedConfig.allowPositionals !== 'undefined',
		strict: true,
	};

	try {
		const { tokens, ...results } = parseArgs(newObj);

		const enumEntries = entries(enums);
		if (enumEntries.length > 0) {
			enumEntries.forEach(([key, config]) => {
				const value = results.values[key];
				if (!config.choices.includes(value)) {
					errors[errors.length] = `Error: Invalid value for option "${key}"`;
				}
			});
		}

		// eslint-disable-next-line no-inner-declarations
		async function help() {
			if (('help' in results.values && results.values.help) || errors.length > 0) {
				const helpText = await `${await readFile(join(dirname(realEntrypointPath), './help.txt'), 'utf-8')}`;
				if (errors.length === 0) {
					console.log(helpText);
				} else {
					console.error(`${helpText}\n`);

					process.exitCode ||= parseInt('1'.repeat(errors.length), 2);
					errors.forEach((error) => console.error(error));
				}

				process.exit();
			}
		}

		const { allowPositionals } = passedConfig;

		const posCount = typeof allowPositionals === 'number' ? allowPositionals : allowPositionals || subcommands ? Infinity : 0;
		if (results.positionals.length > posCount) {
			errors[errors.length] = `Only ${posCount} positional arguments allowed; got ${results.positionals.length}`;
		}

		const optionTokens = tokens.filter(/** @type {(token: typeof tokens[number]) => token is OptionToken} */ (token) => token.kind === 'option');

		const bools = obj.options ? entries(obj.options).filter(([, { type }]) => type === 'boolean') : [];
		const passedArgs = new Set(optionTokens.map(({ name, rawName }) => (rawName.startsWith('--no-') ? rawName.slice(2) : name)));

		const groups = groupBy(passedArgs, (x) => x.replace(/^no-/, ''));
		for (let i = 0; i < bools.length; i++) {
			const [key] = bools[i];
			if ((groups[key]?.length ?? 0) > 1) {
				errors[errors.length] = `Error: Arguments \`--${key}\` and \`--no-${key}\` are mutually exclusive`;
			}
			// handle --no-* negation
			if (passedArgs.has(`no-${key}`) && !passedArgs.has(key)) {
				results.values[key] = false;
			}
			delete results.values[`no-${key}`];
		}

		const knownOptions = keys(newObj.options);
		const knownBoolOptions = bools.map(([key]) => `no-${key}`);
		const allKnownOptions = new Set(knownOptions.concat(knownBoolOptions));
		const unknownArgs = passedArgs.difference(allKnownOptions);
		if (unknownArgs.size > 0) {
			errors[errors.length] = `Error: Unknown option(s): ${from(unknownArgs, (x) => `\`${x}\``).join(', ')}`;
		}

		/** @type {undefined | PargsParsed<PargsConfig>} */
		let command;
		if (subcommands) {
			const subcommand = argv[0];

			if (hasOwn(/** @type {object} */ (subcommands), subcommand)) {
				process.argv.splice(process.argv.indexOf(subcommand), 1);
				command = await pargs(entrypointPath, subcommands[subcommand]);
			} else {
				errors[errors.length] = `Error: unknown command${subcommand ? ` "${subcommand}"` : ''}`;
			}
		}

		return {
			help,
			errors,
			...results,
			...command && {
				help: command.help,
				command: {
					name: argv[0],
					...command,
				},
			},
			...obj.tokens && { tokens },
		};
	} catch (e) {
		const fakeErrors = [`Error: ${!!e && typeof e === 'object' && 'message' in e && e.message}`];
		if (isParseArgsError(e)) {
			return {
				async help() {
					const helpText = await `${await readFile(join(dirname(realEntrypointPath), './help.txt'), 'utf-8')}`;
					console.error(`${helpText}'\n`);

					process.exitCode ||= parseInt('1', 2);
					console.error(fakeErrors[0]);

					process.exit();
				},
				values: {},
				positionals: [],
				errors: fakeErrors,
			};
		}
		throw e;
	}
}
