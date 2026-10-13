import { parseArgs } from 'util';
import { realpathSync } from 'fs';

import isParseArgsError from './isParseArgsError.mjs';
import maybeStripColors from './maybeStripColors.mjs';
import getHelpText, { getVersion, kCommandPath } from './getHelpText.mjs';
import resolveShorts, { kInheritedShorts, routedShorts } from './resolveShorts.mjs';
import { bareValue, needsNormalizing, normalizeWithOrigins, scrubBareTokens } from './normalizeArgs.mjs';
import leadingOptions from './leadingOptions.mjs';

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
 *   PargsOptionConfig,
 *   PargsParsed,
 *   ParseArgsConfig,
 * } from './types.d.mts'
 */

/** @import { PargsInternalConfig } from './getHelpText.mjs' */

// a recursive call uses this to tell a subcommand whether the `process.argv`
// splice is still its to perform; it can not be expressed in the public config
const kMutateArgv = Symbol('pargs: may splice process.argv');

// a subcommand that inherited `version` from its parent did not write it there
// itself, so a clash with its own `version` option was not declared in one place
const kInheritedVersion = Symbol('pargs: `version` was inherited');

// Swap the internal sentinel back out for what the config asked a bare
// occurrence to mean, so it is never observable from outside.
/** @typedef {string | boolean | (string | boolean)[] | undefined} ParsedValue */
/** @type {(bare: true | string, value: ParsedValue) => ParsedValue} */
function replaceBareValue(bare, value) {
	if (isArray(value)) {
		// a bare occurrence contributes nothing to a `multiple` option, unless
		// every occurrence was bare - then there is no list to speak of. An
		// already-empty list is a declared `default`, not a run of bare
		// occurrences, so it is left exactly as the config asked for.
		const real = value.filter((v) => v !== bareValue);
		return value.length > 0 && real.length === 0 ? bare : real;
	}
	return value === bareValue ? bare : value;
}

// Salvage what can be salvaged from a loose (`strict: false`) reparse after a
// fatal parse error: keep only declared options whose parsed value still
// matches the declared type, applying the same coercion the strict path does.
/** @type {(schema: { normalized: NonNullable<ParseArgsConfig['options']>, options: Readonly<Record<string, PargsOptionConfig>>, bares: Record<string, unknown> }, looseValues: Record<string, unknown>) => Record<string, unknown>} */
function partialValues(schema, looseValues) {
	const {
		normalized,
		options,
		bares,
	} = schema;
	return fromEntries(entries(looseValues).flatMap(([key, value]) => {
		if (!hasOwn(normalized, key)) {
			return [];
		}
		/** @type {unknown[]} */
		const list = /** @type {unknown[]} */ ([]).concat(value);

		// a bare occurrence already stands in for its declared type, so it is kept without being measured against it
		if (hasOwn(bares, key) && list.every((v) => v === bares[key])) {
			return [[key, value]];
		}

		const { multiple } = normalized[key];
		// `normalizedOptions` has already rewritten `enum`/`number`/`integer` to
		// `'string'`, so the declared type comes off the original config - except
		// for the injected `help`/`version`, which only exist in the normalized one
		const declared = hasOwn(options, key) ? options[key] : null;
		const { type } = declared ?? normalized[key];
		const typesMatch = type === 'boolean'
			? list.every((v) => typeof v === 'boolean')
			: list.every((v) => typeof v === 'string');
		if (!typesMatch) {
			return [];
		}
		if (declared?.type === 'enum') {
			/** @type {{ choices: readonly unknown[] }} */
			const { choices } = declared;
			return list.every((v) => choices.includes(v)) ? [[key, value]] : [];
		}
		if (type === 'number' || type === 'integer') {
			const nums = list.map(Number);
			const valid = nums.every((num) => Number.isFinite(num) && (type !== 'integer' || Number.isInteger(num)));
			return valid ? [[key, multiple ? nums : nums[0]]] : [];
		}
		return [[key, value]];
	}));
}

/** @type {typeof import('./types.d.mts').default} */
export default async function pargs(entrypointPath, obj) {
	const realEntrypointPath = realpathSync(entrypointPath);
	// `process.execPath` is not always realpathed (eg, node reached through a
	// symlink or junction), but each `arg` is compared after being realpathed
	const realExecPath = realpathSync(process.execPath);

	if ('help' in obj || (obj.options && 'help' in obj.options)) {
		throw new TypeError('The "help" option is reserved');
	}

	const hasArgs = typeof obj.args !== 'undefined';
	if (hasArgs && !isArray(obj.args)) {
		throw new TypeError('Error: `args`, when provided, must be an array');
	}

	// an explicit `args` is already the caller's argument list: there is no node
	// binary or entrypoint prefix to strip, so it is used verbatim.
	const argv = hasArgs ? from(/** @type {readonly string[]} */ (obj.args), String) : process.argv.flatMap((arg) => {
		try {
			const realpathedArg = realpathSync(arg);
			if (
				realpathedArg === realExecPath
				|| realpathedArg === realEntrypointPath
			) {
				return [];
			}
		} catch { /**/ }
		return arg;
	});

	/** @type {string[]} */
	const errors = [];

	if ('subcommands' in obj && (!obj.subcommands || typeof obj.subcommands !== 'object')) {
		throw new TypeError('Error: `subcommands` must be an object');
	}

	const {
		subcommands,
		defaultCommand,
		negation: rootNegation,
		...passedConfig
	} = obj;

	if (typeof rootNegation !== 'undefined' && rootNegation !== 'exclusive' && rootNegation !== 'last-wins') {
		throw new TypeError('Error: `negation` must be either "exclusive" or "last-wins"');
	}

	if ('subcommands' in obj && keys(/** @type {object} */ (obj.subcommands)).length === 0) {
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
		if (!hasOwn(subcommands, /** @type {string} */ (defaultCommand))) {
			throw new TypeError('Error: `defaultCommand` must be a key of `subcommands`');
		}
	}

	// `version` is provided automatically, but a user-defined `version` option
	// (with its own handling) is preferred over the built-in one.
	const hasUserVersion = !!passedConfig.options && 'version' in passedConfig.options;

	// a root `version` of `false` drops the built-in `--version` entirely; a string
	// is printed verbatim, so a caller can opt out of the `v` prefix, or print more
	// than the bare number. `true`, or absent, is the `package.json` lookup.
	// an explicitly `undefined` `version` is "absent", so that spreading an optional
	// field is not a startup error.
	const versionConfig = typeof obj.version === 'undefined' ? true : obj.version;
	if (typeof versionConfig !== 'boolean' && typeof versionConfig !== 'string') {
		throw new TypeError('Error: `version` must be a boolean or a string');
	}
	const versionInherited = !!(/** @type {Record<symbol, boolean>} */ (obj))[kInheritedVersion];
	if (hasUserVersion && versionConfig !== true && !versionInherited) {
		throw new TypeError('Error: `version` is not allowed when a `version` option is declared');
	}
	const hasBuiltinVersion = !hasUserVersion && versionConfig !== false;

	const shorts = resolveShorts(obj);

	// an explicitly `undefined` `usageOnError` is "absent", so that spreading an
	// optional field is not a startup error
	const usageOnError = typeof obj.usageOnError === 'undefined' ? 'stdout' : obj.usageOnError;
	if (usageOnError !== false && usageOnError !== 'stdout' && usageOnError !== 'stderr') {
		throw new TypeError("Error: `usageOnError` must be `false`, `'stdout'`, or `'stderr'`");
	}

	// the `version`, output, and reserved-option policies are inherited by
	// subcommands: a CLI that says it has no built-in `--version`, or that prints
	// its own string, or that keeps usage off stdout, must mean that at every
	// level. A subcommand may declare its own to override them.
	const inherited = {
		...typeof obj.version !== 'undefined' && { version: obj.version },
		...hasOwn(obj, 'shorts') && { shorts: obj.shorts },
		...typeof obj.usageOnError !== 'undefined' && { usageOnError },
	};

	const partial = !!passedConfig.partialValues;

	/** @type {Record<string, { choices: readonly string[] }>} */
	// @ts-expect-error __proto__
	const enums = { __proto__: null };
	/** @type {Record<string, 'number' | 'integer'>} */
	// @ts-expect-error __proto__
	const numbers = { __proto__: null };

	/** @type {Record<string, true | string>} */
	// @ts-expect-error __proto__
	const bares = { __proto__: null };

	/** @type {[string, PargsOptionConfig][]} */
	const optsEntries = entries(passedConfig.options ?? {});

	/** @typedef {NonNullable<ParseArgsConfig['options']>} ParseArgsOptions */
	/** @typedef {(entry: [string, PargsOptionConfig]) => [string, ParseArgsOptions[string]][]} Normalize */
	/** @typedef {ParseArgsOptions & { help: { default: false, type: 'boolean' } }} NormalizedOptions */
	/** @type {Normalize} */
	const normalize = ([key, value]) => {
		if (typeof value.negation !== 'undefined' && value.negation !== 'exclusive' && value.negation !== 'last-wins') {
			throw new TypeError(`Error: \`negation\` must be either "exclusive" or "last-wins"; \`${key}\` is invalid`);
		}

		if (
			typeof value.optionalValue !== 'undefined'
			&& typeof value.optionalValue !== 'boolean'
			&& typeof value.optionalValue !== 'string'
		) {
			throw new TypeError(`Error: \`optionalValue\` must be a boolean or a string; \`${key}\` is invalid`);
		}

		// an `optionalValue` of `''` is a value the config asked for, so it can not be
		// tested for truthiness
		const hasOptionalValue = value.optionalValue === true || typeof value.optionalValue === 'string';

		if (value.type === 'boolean' && (value.greedy || hasOptionalValue || value.variadic)) {
			throw new TypeError(`Error: \`greedy\`, \`optionalValue\`, and \`variadic\` are not allowed on a boolean option; \`${key}\` is invalid`);
		}

		// `greedy` always takes the next token, so an optional value could only ever
		// apply at the end of the argument list - the two contradict each other
		if (value.greedy && hasOptionalValue) {
			throw new TypeError(`Error: \`greedy\` and \`optionalValue\` can not be combined, since \`greedy\` always takes the next token; \`${key}\` is invalid`);
		}

		if (value.optionalValue === true) {
			bares[key] = true;
		}

		// the types already rule this out, but a JS caller's config is not checked
		if (value.variadic && (/** @type {{ multiple?: boolean }} */ (value)).multiple === false) {
			throw new TypeError(`Error: \`variadic\` implies \`multiple\`, so \`multiple: false\` is not allowed; \`${key}\` is invalid`);
		}

		// a variadic option collects many values per occurrence, so its value is
		// always an array - which, in `parseArgs` terms, is `multiple: true`
		const option = value.variadic
			? {
				...value,
				multiple: true,
				// a `number`/`integer` default is converted to strings below
				...'default' in value && { default: /** @type {string[]} */ (/** @type {unknown[]} */ ([]).concat(value.default)) },
			}
			: value;

		if (option.type === 'enum') {
			if (!isArray(option.choices) || !option.choices.every((/** @type {unknown} */ x) => typeof x === 'string')) {
				throw new TypeError(`Error: enum choices must be an array of strings; \`${key}\` is invalid`);
			}

			enums[key] = option;
			return [[key, { ...option, type: /** @type {const} */ ('string') }]];
		}

		if (option.type === 'number' || option.type === 'integer') {
			numbers[key] = option.type;
			// only an own, enumerable `default` survives the spread, so test that copy
			const stringOption = { ...option, type: /** @type {const} */ ('string') };
			const { default: numeric, ...converted } = stringOption;
			if ('default' in stringOption) {
				const def = /** @type {unknown[]} */ ([]).concat(numeric).map(String);
				return [[key, { ...converted, default: converted.multiple ? def : def[0] }]];
			}
			return [[key, converted]];
		}

		return [[key, option]];
	};

	// `help` is always appended, which `fromEntries` can not see
	const normalizedOptions = /** @type {NormalizedOptions} */ (fromEntries(optsEntries.flatMap(normalize).concat([
		[
			'help',
			{
				default: false,
				type: 'boolean',
				...shorts.help && { short: shorts.help },
			},
		],
	]).concat(hasBuiltinVersion ? [
		[
			'version',
			{
				default: false,
				type: 'boolean',
				...shorts.version && { short: shorts.version },
			},
		],
	] : [])));

	// when subcommands are defined, the root parses only its own options, and
	// only those that lead the argument list, git-style; the first arg after
	// them selects the subcommand. If it is not a known subcommand, fall back to
	// `defaultCommand` (parsing the rest of argv against it) when one is
	// configured. An option the `defaultCommand` also accepts - by name, or by
	// short - belongs to that command, so that a root which mirrors its default
	// command's options for the help text keeps routing them there.
	const routed = typeof defaultCommand === 'string' && subcommands ? subcommands[defaultCommand] : null;
	const routedOptions = routed?.options ?? {};
	const routedVersion = routed && hasOwn(routed, 'version') ? routed.version : obj.version;
	const routedAcceptsVersion = hasOwn(routedOptions, 'version') || routedVersion !== false;
	// `--help`, and a `--version` the default command answers, do not end the
	// root options, since every command has them; they still route to the
	// default command, which answers them exactly as it always has
	/** @type {(name: string) => boolean} */
	const isReserved = (name) => !!routed && (name === 'help' || (name === 'version' && routedAcceptsVersion));
	const claimedShorts = routedShorts(obj);
	const leading = subcommands
		? leadingOptions(
			argv,
			fromEntries(entries(normalizedOptions)
				// a built-in `--version` the default command does not answer is still
				// passed to it, to reject, as it always was
				.filter(([key]) => isReserved(key)
					|| !(hasOwn(routedOptions, key) || (!!routed && key === 'version' && hasBuiltinVersion)))
				.map(([key, { short, ...option }]) => [
					key,
					{
						...option,
						...(claimedShorts.get(/** @type {string} */ (short)) ?? key) === key && { short },
					},
				])),
			{
				negatable: new Set(optsEntries.filter(([, { type }]) => type === 'boolean').map(([key]) => key)),
				commands: new Set(keys(subcommands)),
			},
		)
		: {
			count: 0,
			steps: [],
		};
	const reservedSteps = leading.steps.filter(({ names }) => names.some(isReserved));
	const rest = argv.slice(leading.count);
	const knownSubcommand = !!subcommands && reservedSteps.length === 0 && hasOwn(subcommands, rest[0]);
	const routeToDefault = !!routed && !knownSubcommand;

	// a cluster that mixes a reserved short with the root's own stays with the
	// root, whose `--help`/`--version` the routed default command's help honors
	const forwarded = routeToDefault ? reservedSteps.filter(({ names }) => names.every(isReserved)) : [];
	/** @type {(steps: typeof leading.steps) => string[]} */
	const argsOf = (steps) => steps.flatMap(({ start, end }) => argv.slice(start, end));
	const forwardedArgs = argsOf(forwarded);

	/** @type {ParseArgsConfig & { tokens: true, allowNegative: true, strict: true, options: typeof normalizedOptions, args: readonly string[] }} */
	const newObj = {
		...passedConfig,
		args: subcommands
			? routeToDefault
				? argsOf(leading.steps.filter((step) => !forwarded.includes(step)))
				: argv.slice(0, leading.count + 1)
			: argv,
		options: normalizedOptions,
		tokens: true,
		allowNegative: true,
		allowPositionals: !!subcommands || typeof passedConfig.allowPositionals !== 'undefined',
		strict: true,
	};

	// only rewrite the argument list when some option actually asks for an arity
	// `parseArgs` can not express, so that every config that does not opt in gets
	// back the identical array - and therefore the identical `tokens`
	const normalizing = needsNormalizing(normalizedOptions);
	const normalized = normalizing
		? normalizeWithOrigins(newObj.args, normalizedOptions, new Set(keys(subcommands ?? {})))
		: null;
	if (normalized) {
		newObj.args = normalized.out;
	}

	// the forwarded `--help`/`--version` are taken out of the root's args, but
	// its tokens still index the arguments it was given
	const argvIndices = forwarded.length > 0
		? leading.steps
			.filter((step) => !forwarded.includes(step))
			.flatMap(({ start, end }) => from({ length: end - start }, (_, i) => start + i))
		: null;
	/** @type {<T extends { index: number }>(tokens: T[]) => T[]} */
	const reindex = (tokens) => (argvIndices
		? tokens.map((token) => {
			const origin = normalized ? normalized.origins[token.index] : token.index;
			return {
				...token,
				index: token.index + argvIndices[origin] - origin,
			};
		})
		: tokens);

	try {
		const { tokens, ...results } = parseArgs(newObj);

		entries(enums).forEach(([key, config]) => {
			const value = results.values[key];
			if (typeof value === 'undefined') {
				return;
			}

			// the sentinel is only exempt for an option that actually opted in; a
			// caller-supplied `args` could otherwise smuggle it past validation
			const bare = hasOwn(bares, key);

			// a value that is not a declared choice is simply not a member, so widening
			// what `includes` accepts answers that directly - where a `typeof` guard
			// would add an arm nothing ever reaches
			/** @type {{ choices: readonly (string | boolean)[] }} */
			const { choices } = config;

			const ok = (/** @type {(string | boolean)[]} */ ([])).concat(value)
				.every((v) => (bare && v === bareValue) || choices.includes(v));
			if (!ok) {
				errors[errors.length] = `Error: Invalid value for option "${key}"`;
			}
		});

		/** @type {Record<string, string | number | boolean | (string | number | boolean)[] | undefined>} */
		const coerced = results.values;
		entries(numbers).forEach(([key, type]) => {
			const value = results.values[key];
			if (typeof value === 'undefined') {
				return;
			}
			let allValid = true;
			const bare = hasOwn(bares, key);
			const nums = /** @type {unknown[]} */ ([]).concat(value).map((v) => {
				// a bare occurrence is not a number yet; it is swapped out below.
				// only exempt when this option opted in, so a caller-supplied `args`
				// can not smuggle the sentinel past validation.
				if (bare && v === bareValue) {
					return v;
				}
				const num = Number(v);
				if (!Number.isFinite(num) || (type === 'integer' && !Number.isInteger(num))) {
					allValid = false;
				}
				return num;
			});
			if (!allValid) {
				errors[errors.length] = `Error: Invalid ${type} value for option "${key}"`;
			}
			coerced[key] = isArray(value) ? nums : nums[0];
		});

		entries(bares).forEach(([key, bare]) => {
			// only ever rewrite a key the user actually passed; creating one here
			// would make an unpassed option indistinguishable from a passed one
			if (hasOwn(results.values, key)) {
				results.values[key] = replaceBareValue(bare, results.values[key]);
			}
		});

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
			const [key, boolConfig] = bools[i];
			const negation = typeof boolConfig.negation === 'undefined' ? rootNegation : boolConfig.negation;
			if (negation !== 'last-wins' && (groups[key]?.length ?? 0) > 1) {
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
		/** @type {undefined | string} */
		let commandName;
		/** @type {undefined | (PargsInternalConfig & { [kMutateArgv]: boolean, [kInheritedVersion]: boolean })} */
		let commandConfig;
		// the top level owns the `process.argv` splice, and only when it is the
		// thing being parsed; a nested call inherits the answer from its parent.
		const mayMutateArgv = hasOwn(obj, kMutateArgv)
			? /** @type {Record<symbol, boolean>} */ (obj)[kMutateArgv]
			: !hasArgs;
		// a root-level `--help` or `--version` is answered at the root, whether or
		// not a subcommand follows it
		const rootRequested = !routeToDefault
			&& (!!results.values.help || (hasBuiltinVersion && !!results.values.version));
		if (subcommands) {
			if (knownSubcommand) {
				([commandName] = rest);
				if (mayMutateArgv) {
					// `rest` is the tail of `argv`, which is the tail of `process.argv`
					// unless an argument was filtered out of the middle of it; a leading
					// option's value may equal the command name, so search from where the
					// tail starts, rather than from the beginning
					const at = process.argv.indexOf(rest[0], process.argv.length - rest.length);
					process.argv.splice(at === -1 ? process.argv.indexOf(rest[0]) : at, 1);
				}
			} else if (routeToDefault) {
				commandName = defaultCommand;
			}

			if (typeof commandName === 'string') {
				// the parent's routing decides what the subcommand sees, so its args are
				// injected after the subcommand's own config, not before it
				commandConfig = {
					...inherited,
					...subcommands[commandName],
					args: knownSubcommand ? rest.slice(1) : forwardedArgs.concat(rest),
					[kMutateArgv]: mayMutateArgv,
					// so the subcommand's usage line names the command it is for
					[kCommandPath]: (/** @type {Record<symbol, string[] | undefined>} */ (obj)[kCommandPath] ?? [])
						.concat(commandName),
					// only mark it inherited when the subcommand did not write its own - a
					// clash it declared itself is still an error
					[kInheritedVersion]: hasOwn(inherited, 'version') && !hasOwn(subcommands[commandName], 'version'),
					// only mark the request as inherited when the subcommand did not
					// write its own - a collision it declared itself is still an error
					...hasOwn(inherited, 'shorts')
						&& !hasOwn(subcommands[commandName], 'shorts')
						&& { [kInheritedShorts]: true },
				};
				command = await pargs(entrypointPath, commandConfig);
			} else if (
				!rootRequested
				&& (rest.length > 0 || !optionTokens.some(({ name }) => name !== 'help' && (hasUserVersion || name !== 'version')))
			) {
				// with no command at all, a root option the user did pass is the whole
				// invocation (eg, `cli --setup`); a bare invocation is still an error
				const [subcommand] = rest;
				errors[errors.length] = `Error: unknown command${subcommand ? ` "${subcommand}"` : ''}`;
			}
		}

		// `--help`/`--version` (and errors) apply at the invoked level: a routed
		// default command is still "the root", so honor its flags with the root
		// (command-listing) help rather than the default command's own help.
		// A reserved short the root kept, in a cluster with its own, still counts.
		const helpValues = routeToDefault && command
			? {
				...command.values,
				help: !!command.values.help || !!results.values.help,
				version: !!command.values.version || !!results.values.version,
			}
			: results.values;
		/** @type {(level: undefined | { errors: string[], command?: unknown }) => string[]} */
		const chainErrors = (level) => (level
			? level.errors.concat(chainErrors(/** @type {typeof level} */ (level.command)))
			: []);
		// read when `help()` runs, not now, since a caller may push its own; a root
		// option's error is the root's to report, even when a command ran, and
		// then so is every error the command's own `help()` would have reported
		/** @type {() => string[]} */
		const getHelpErrors = () => {
			if (errors.length > 0) {
				return errors.concat(chainErrors(command));
			}
			return routeToDefault && command ? command.errors : errors;
		};
		// the `version` policy is read from whichever level parsed the flag - the
		// routed default command's *merged* config, so that what it inherited from
		// the root counts, not just what it declared itself
		const helpConfig = routeToDefault && commandConfig ? commandConfig : obj;
		const helpVersionConfig = typeof helpConfig.version === 'undefined' ? true : helpConfig.version;
		// a `version` option declared at *this* level means the caller prints it
		// themselves, no matter which level ended up parsing the flag
		const helpBuiltinVersion = !hasUserVersion
			&& !(helpConfig.options && 'version' in helpConfig.options)
			&& helpVersionConfig !== false;
		/** @type {(options?: { exit?: boolean }) => Promise<'version' | 'help' | 'errors' | false>} */
		async function help(options) {
			// `options || {}`, not a defaulted parameter, so that passing the `null`
			// a `promise.then(help)` would hand it is not a crash
			const { exit = true } = options || {};
			const helpErrors = getHelpErrors();
			if (helpBuiltinVersion && helpValues.version) {
				const version = typeof helpVersionConfig === 'string'
					? helpVersionConfig
					: await getVersion(realEntrypointPath).then((v) => (v ? `v${v}` : v));
				console.log(version);
				if (exit) {
					process.exit();
				}
				return 'version';
			}
			const wantsHelp = 'help' in helpValues && !!helpValues.help;
			if (wantsHelp || helpErrors.length > 0) {
				// help the user explicitly asked for is program output, so it always
				// prints, and always to stdout; `usageOnError` only governs usage
				// dumped alongside an error they did not ask for
				if (wantsHelp || usageOnError !== false) {
					const helpText = maybeStripColors(`${(await getHelpText(realEntrypointPath, obj)).trim()}\n`);
					const stream = wantsHelp || usageOnError !== 'stderr' ? 'log' : 'error';
					console[stream](helpErrors.length === 0 ? helpText : `${helpText}\n`);
				}
				if (helpErrors.length > 0) {
					process.exitCode ||= parseInt('1'.repeat(helpErrors.length), 2);
					helpErrors.forEach((error) => console.error(error));
				}

				if (exit) {
					process.exit();
				}
				return helpErrors.length === 0 ? 'help' : 'errors';
			}
			return false;
		}

		// @ts-expect-error TODO: figure out how to make this work
		return {
			help,
			errors,
			...results,
			...command && {
				/** @type {typeof help} */
				help: (options) => (routeToDefault || rootRequested || errors.length > 0
					? help(options)
					: command.help(options)),
				command: {
					name: commandName,
					...command,
				},
			},
			...obj.tokens && { tokens: reindex(normalizing ? scrubBareTokens(tokens) : tokens) },
		};
	} catch (e) {
		const fakeErrors = [`Error: ${!!e && typeof e === 'object' && 'message' in e && e.message}`];
		if (isParseArgsError(e)) {
			const {
				tokens,
				values: looseValues,
				positionals: loosePositionals,
			} = parseArgs({
				...newObj,
				strict: false,
				allowPositionals: true,
			});
			if (partial) {
				entries(bares).forEach(([key, bare]) => {
					if (hasOwn(looseValues, key)) {
						/** @type {Record<string, ParsedValue>} */
						const loose = looseValues;
						loose[key] = replaceBareValue(bare, loose[key]);
					}
				});
			}
			// the loose reparse still tells us whether `--help` was asked for, which
			// the success path honors and this one must too: whether a mistake
			// happens to be fatal to `parseArgs` is not the user's concern.
			// `--version` is deliberately not honored here - a version string does not
			// help anyone fix a malformed command line, and printing it would mask the
			// error it was typed alongside
			const wantsHelp = !!looseValues.help;

			// @ts-expect-error TODO: figure out how to make this work
			return {
				async help(options) {
					const { exit = true } = options || {};
					if (wantsHelp || usageOnError !== false) {
						const helpText = maybeStripColors(await getHelpText(realEntrypointPath, obj));
						console[wantsHelp || usageOnError !== 'stderr' ? 'log' : 'error'](`${helpText}\n`);
					}

					process.exitCode ||= parseInt('1', 2);
					console.error(fakeErrors[0]);

					if (exit) {
						process.exit();
					}
					return 'errors';
				},
				values: partial
					? partialValues(
						{
							normalized: normalizedOptions,
							options: passedConfig.options ?? {},
							bares,
						},
						looseValues,
					)
					: {},
				positionals: partial ? loosePositionals : [],
				errors: fakeErrors,
				...obj.tokens && { tokens: reindex(normalizing ? scrubBareTokens(tokens) : tokens) },
			};
		}
		throw e;
	}
}
