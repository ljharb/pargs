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

// an `optionalValue` of `''` is a real value the config asked for, so it can not
// be tested for truthiness
/** @type {(config: any) => boolean} */
function hasOptionalValue(config) {
	return config.optionalValue === true || typeof config.optionalValue === 'string';
}

/** @type {(config: any) => boolean} */
function hasArity(config) {
	return !!config.greedy || hasOptionalValue(config);
}

// A bare occurrence of an `optionalValue: true` option carries the sentinel
// through `parseArgs`; put the tokens back the way parseArgs reports a
// valueless option, so it never reaches a consumer.
/** @type {(tokens: readonly any[]) => any[]} */
export function scrubBareTokens(tokens) {
	return tokens.map((token) => (
		token.kind === 'option' && token.value === bareValue
			? {
				...token,
				value: undefined,
				inlineValue: undefined,
			}
			: token
	));
}

/** @type {(options: Record<string, any>) => boolean} */
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
/** @type {(arg: string, options: Record<string, any>, shorts: Record<string, string>) => string | null} */
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

/** @type {(state: { out: string[], args: string[], i: number, name: string, config: any }) => number} */
function pushOption(state) {
	const {
		out,
		args,
		i,
		name,
		config,
	} = state;
	const arg = args[i];
	const next = args[i + 1];
	// a long option takes `=value`; a short one takes the value attached
	const glue = arg[1] === '-' ? '=' : '';
	if (isValueLike(next)) {
		out.push(arg, next);
		return i + 2;
	}
	if (config.greedy && typeof next === 'string' && next !== '--') {
		out[out.length] = `${arg}${glue}${next}`;
		return i + 2;
	}
	if (hasOptionalValue(config)) {
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
		return i + 1;
	}
	out[out.length] = arg;
	return i + 1;
}

/** @type {(args: string[], options: Record<string, any>) => string[]} */
export default function normalizeArgs(args, options) {
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
	let i = 0;
	// where the previous step began; a token is only a pending value if that step
	// *left it in place*, so a value already swallowed by an arity option ahead of
	// it does not make this one look spoken for
	let previousStart = -1;
	while (i < args.length) {
		const arg = args[i];
		if (arg === '--') {
			// everything after the terminator is a positional, verbatim
			out.push(...args.slice(i));
			return out;
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
			});
		} else {
			out[out.length] = arg;
			i += 1;
		}
	}
	return out;
}
