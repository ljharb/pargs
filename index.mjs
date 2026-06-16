import { parseArgs } from 'util';
import { realpathSync } from 'fs';

import isParseArgsError from './isParseArgsError.mjs';
import maybeStripColors from './maybeStripColors.mjs';
import getHelpText from './getHelpText.mjs';

const {
	hasOwn,
	fromEntries,
	groupBy,
	keys,
	entries,
} = Object;

const {
	from,
	isArray,
} = Array;

/**
 * @import {
 *   OptionToken,
 *   PargsConfig,
 *   PargsParsed,
 *   ParseArgsConfig,
 * } from './index.d.mts'
 */

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
		} catch { /**/ }
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

	const {
		subcommands,
		defaultCommand,
		...passedConfig
	} = obj;

	if ('subcommands' in obj && keys(obj.subcommands).length === 0) {
		throw new TypeError('Error: `subcommands` must be an object with at least one key');
	}

	if ('subcommands' in obj && 'allowPositionals' in passedConfig) {
		throw new TypeError('Error: `allowPositionals` is not allowed when `subcommands` is defined');
	}

	if ('subcommands' in obj && 'minPositionals' in passedConfig) {
		throw new TypeError('Error: `minPositionals` is not allowed when `subcommands` is defined');
	}

	if ('defaultCommand' in obj) {
		if (!subcommands) {
			throw new TypeError('Error: `defaultCommand` is not allowed unless `subcommands` is defined');
		}
		if (!hasOwn(subcommands, defaultCommand)) {
			throw new TypeError('Error: `defaultCommand` must be a key of `subcommands`');
		}
	}

	// when subcommands are defined, the first arg selects the subcommand;
	// if it is not a known subcommand, fall back to `defaultCommand`
	// (parsing the full argv against it) when one is configured.
	const knownSubcommand = !!subcommands && hasOwn(subcommands, argv[0]);
	const routeToDefault = !!subcommands && !knownSubcommand && typeof defaultCommand === 'string';

	const enums = { __proto__: null };
	const numbers = { __proto__: null };

	/** @type {{ options: ParseArgsConfig['options'] & { help: { default: false, type: 'boolean' } } }} */
	const normalizedOptions = fromEntries(entries(passedConfig.options ?? {}).flatMap(([key, value]) => {
		if (value.type === 'enum') {
			if (!isArray(value.choices) || !value.choices.every((x) => typeof x === 'string')) {
				throw new TypeError(`Error: enum choices must be an array of strings; \`${key}\` is invalid`);
			}

			enums[key] = value;
			return [[key, { ...value, type: 'string' }]];
		}

		if (value.type === 'number' || value.type === 'integer') {
			numbers[key] = value.type;
			var converted = { ...value, type: 'string' }; // eslint-disable-line no-var
			if ('default' in converted) {
				var def = [].concat(converted.default).map(String); // eslint-disable-line no-var
				converted.default = converted.multiple ? def : def[0];
			}
			return [[key, converted]];
		}

		return [[key, value]];
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
		args: subcommands ? routeToDefault ? [] : argv.slice(0, 1) : argv,
		...passedConfig,
		options: normalizedOptions,
		tokens: true,
		allowNegative: true,
		allowPositionals: !!subcommands || typeof passedConfig.allowPositionals !== 'undefined',
		strict: true,
	};

	try {
		const { tokens, ...results } = parseArgs(newObj);

		entries(enums).forEach(([key, config]) => {
			const value = results.values[key];
			if (!config.choices.includes(value)) {
				errors[errors.length] = `Error: Invalid value for option "${key}"`;
			}
		});

		entries(numbers).forEach(([key, type]) => {
			const value = results.values[key];
			if (typeof value === 'undefined') {
				return;
			}
			var allValid = true; // eslint-disable-line no-var
			const nums = [].concat(value).map((v) => {
				const num = Number(v);
				if (!Number.isFinite(num) || (type === 'integer' && !Number.isInteger(num))) {
					allValid = false;
				}
				return num;
			});
			if (!allValid) {
				errors[errors.length] = `Error: Invalid ${type} value for option "${key}"`;
			}
			results.values[key] = isArray(value) ? nums : nums[0];
		});

		async function help() {
			if (('help' in results.values && results.values.help) || errors.length > 0) {
				const helpText = maybeStripColors(`${(await getHelpText(realEntrypointPath, obj)).trim()}\n`);
				if (errors.length === 0) {
					console.log(helpText);
				} else {
					console.log(`${helpText}\n`);

					process.exitCode ||= parseInt('1'.repeat(errors.length), 2);
					errors.forEach((error) => console.error(error));
				}

				process.exit();
			}
		}

		const { allowPositionals, minPositionals } = passedConfig;

		if (!results.values.help) {
			const posCount = typeof allowPositionals === 'number' ? allowPositionals : allowPositionals || subcommands ? Infinity : 0;
			if (results.positionals.length > posCount) {
				errors[errors.length] = `Only ${posCount} positional arguments allowed; got ${results.positionals.length}`;
			}
			const minPos = typeof minPositionals === 'number' ? minPositionals : 0;
			if (results.positionals.length < minPos) {
				errors[errors.length] = `At least ${minPos} positional arguments required; got ${results.positionals.length}`;
			}
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
		/** @type {string | undefined} */
		let commandName;
		if (subcommands) {
			if (knownSubcommand) {
				([commandName] = argv);
				process.argv.splice(process.argv.indexOf(argv[0]), 1);
			} else if (routeToDefault) {
				commandName = defaultCommand;
			}

			if (typeof commandName === 'string') {
				command = await pargs(entrypointPath, subcommands[commandName]);
			} else {
				const subcommand = argv[0];
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
					name: commandName,
					...command,
				},
			},
			...obj.tokens && { tokens },
		};
	} catch (e) {
		const fakeErrors = [`Error: ${!!e && typeof e === 'object' && 'message' in e && e.message}`];
		if (isParseArgsError(e)) {
			const { tokens } = parseArgs({
				...newObj,
				strict: false,
				allowPositionals: true,
			});
			return {
				async help() {
					const helpText = maybeStripColors(await getHelpText(realEntrypointPath, obj));
					console.log(`${helpText}\n`);

					process.exitCode ||= parseInt('1', 2);
					console.error(fakeErrors[0]);

					process.exit();
				},
				values: {},
				positionals: [],
				errors: fakeErrors,
				...obj.tokens && { tokens },
			};
		}
		throw e;
	}
}
