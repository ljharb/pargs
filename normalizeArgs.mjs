const {
	entries,
	hasOwn,
} = Object;

// `util.parseArgs` has exactly one arity rule: a `string` option consumes the
// next token unless that token looks like an option. Anything else - an option
// whose value may start with a dash, one whose value is optional, one that
// collects a run of values - has to be rewritten into a form parseArgs already
// understands, before it ever sees the argument list.

// An argv element can never contain a NUL byte - `execve` terminates each
// argument on one - so this can not collide with anything a user typed. It can
// only arrive through a programmatic `args`, which is rejected below.
export const bareValue = '\0pargs:bare\0';

// an option as `parseArgs` is handed it, plus the arity keys only pargs reads
/** @typedef {{ type: string, short?: string, multiple?: boolean, greedy?: boolean, optionalValue?: boolean | string, variadic?: boolean }} ArityOptionConfig */
/** @typedef {Readonly<Record<string, ArityOptionConfig>>} ArityOptions */
/** @typedef {NonNullable<ReturnType<typeof import('util').parseArgs>['tokens']>[number]} Token */

// an `optionalValue` of `''` is a real value the config asked for, so it can not
// be tested for truthiness
/** @type {(config: ArityOptionConfig) => boolean} */
function hasOptionalValue(config) {
	return config.optionalValue === true || typeof config.optionalValue === 'string';
}

/** @type {(config: ArityOptionConfig) => boolean} */
function hasArity(config) {
	return !!config.greedy || hasOptionalValue(config) || !!config.variadic;
}

// A bare occurrence of an `optionalValue: true` option carries the sentinel
// through `parseArgs`; put the tokens back the way parseArgs reports a
// valueless option, so it never reaches a consumer.
/** @type {(tokens: readonly Token[]) => Token[]} */
export function scrubBareTokens(tokens) {
	return tokens.map((token) => (
		token.kind === 'option' && token.value === bareValue
			? {
				...token,
				value: void undefined,
				inlineValue: void undefined,
			}
			: token
	));
}

/** @type {(options: ArityOptions) => boolean} */
export function needsNormalizing(options) {
	return entries(options).some(([, config]) => hasArity(config));
}

// a lone `-` is conventionally a value (stdin), not an option
/** @type {(arg: string | undefined) => boolean} */
function isValueLike(arg) {
	return typeof arg === 'string' && (arg === '-' || arg[0] !== '-');
}

// The long or short option `arg` names, when it is written bare - no `=`, no
// attached short value - and is one we know. `'--'` is handled by the caller,
// so a long option always has a name here.
/** @type {(arg: string, options: ArityOptions, shorts: Record<string, string>) => string | null} */
function bareOptionName(arg, options, shorts) {
	if (arg.startsWith('--')) {
		const name = arg.slice(2);
		return !name.includes('=') && hasOwn(options, name) ? name : null;
	}
	if (arg.length < 2 || arg[0] !== '-') {
		return null;
	}
	// in a short cluster, only the last character may take a value; anything
	// earlier that is not a known boolean means this is not ours to rewrite
	const chars = arg.slice(1).split('');
	const at = chars.findIndex((char) => !hasOwn(shorts, char) || options[shorts[char]].type !== 'boolean');
	return at === chars.length - 1 && hasOwn(shorts, chars[at]) ? shorts[chars[at]] : null;
}

/** @type {(state: { out: string[], args: readonly string[], i: number, name: string, config: ArityOptionConfig, stops: ReadonlySet<string> }) => number} */
function pushOption(state) {
	const {
		out,
		args,
		i,
		name,
		config,
		stops,
	} = state;
	const arg = args[i];
	const next = args[i + 1];
	// a long option takes `=value`; a short one takes the value attached
	const glue = arg[1] === '-' ? '=' : '';
	let j;
	if (isValueLike(next)) {
		out[out.length] = arg;
		out[out.length] = next;
		j = i + 2;
	} else if (config.greedy && typeof next === 'string' && next !== '--') {
		out[out.length] = `${arg}${glue}${next}`;
		j = i + 2;
	} else if (hasOptionalValue(config)) {
		// `parseArgs` has no optional-value arity, so a bare occurrence is given
		// one: either the string the config named, or the sentinel standing in for
		// "passed with no value"
		const injected = config.optionalValue === true ? bareValue : config.optionalValue;
		if (injected === '') {
			// an empty value can not be attached to a short - `-p` plus `''` is just
			// `-p` again - so spell that one out in long form. Anything earlier in the
			// cluster has to be re-emitted, since `--name=` can not carry it.
			if (arg[1] !== '-' && arg.length > 2) {
				out[out.length] = arg.slice(0, -1);
			}
			out[out.length] = `--${name}=`;
		} else {
			out[out.length] = `${arg}${glue}${injected}`;
		}
		j = i + 1;
	} else {
		out[out.length] = arg;
		j = i + 1;
	}
	if (config.variadic) {
		// keep collecting the run as repeated occurrences, which is the shape
		// `multiple` already understands; `greedy` widens what counts as a value,
		// so that it governs the whole run rather than only its first element. A
		// token in `stops` (a subcommand name, after leading root options) ends the
		// run, so that the command it names is not also collected as a value.
		while (
			typeof args[j] === 'string'
			&& args[j] !== '--'
			&& !stops.has(args[j])
			&& (config.greedy || isValueLike(args[j]))
		) {
			out[out.length] = `--${name}=${args[j]}`;
			j += 1;
		}
	}
	return j;
}

// `origins` holds, for each element of `out`, the index in `args` of the
// argument it was rewritten from, so that a caller can map a position in the
// output back to the argument list it was given.
/** @type {(args: readonly string[], options: ArityOptions, stops?: ReadonlySet<string>) => { out: string[], origins: number[] }} */
export function normalizeWithOrigins(args, options, stops = new Set()) {
	if (args.some((arg) => arg.includes('\0'))) {
		throw new TypeError('Error: arguments may not contain a NUL byte');
	}

	/** @type {Record<string, string>} */
	const shorts = {};
	entries(options).forEach(([name, config]) => {
		// `parseArgs` resolves a duplicated short to the first declaration
		if (typeof config.short === 'string' && !hasOwn(shorts, config.short)) {
			shorts[config.short] = name;
		}
	});

	/** @type {string[]} */
	const out = [];
	/** @type {number[]} */
	const origins = [];
	let i = 0;
	// where the previous step began; a token is only a pending value if that step
	// *left it in place*, so a value already swallowed by an arity option ahead of
	// it does not make this one look spoken for
	let previousStart = -1;
	while (i < args.length) {
		const arg = args[i];
		if (arg === '--') {
			// everything after the terminator is a positional, verbatim
			for (let k = i; k < args.length; k++) {
				out[out.length] = args[k];
				origins[origins.length] = k;
			}
			return { out, origins };
		}
		// If the previous token was a plain value-taking option written bare, this
		// token is that option's value, not an occurrence of its own - rewriting it
		// would put a value in the caller's hands that they never typed.
		const previous = i > 0 && previousStart === i - 1 ? bareOptionName(args[i - 1], options, shorts) : null;
		const isPendingValue = previous !== null
			&& !hasArity(options[previous])
			&& options[previous].type !== 'boolean';
		const name = bareOptionName(arg, options, shorts);
		previousStart = i;
		if (name !== null && !isPendingValue && hasArity(options[name])) {
			i = pushOption({
				out,
				args,
				i,
				name,
				config: options[name],
				stops,
			});
		} else {
			out[out.length] = arg;
			i += 1;
		}
		while (origins.length < out.length) {
			origins[origins.length] = previousStart;
		}
	}
	return { out, origins };
}

/** @type {(args: readonly string[], options: ArityOptions, stops?: ReadonlySet<string>) => string[]} */
export default function normalizeArgs(args, options, stops) {
	return normalizeWithOrigins(args, options, stops).out;
}
