import { parseArgs } from 'util';

import { needsNormalizing, normalizeWithOrigins } from './normalizeArgs.mjs';

const {
	entries,
	fromEntries,
	hasOwn,
} = Object;

/** @import { ParseArgsConfig } from './types.d.mts' */

/** @typedef {{ start: number, end: number, names: string[] }} LeadingStep */

// The leading `args` that are occurrences - values included - of the given
// options. The first token that is anything else (a positional, an option not
// in the set, or the `--` terminator) ends the run, git-style, so that
// everything from there on is left for the subcommand to parse. Arity is the
// parse's own - `optionalValue`, `variadic`, and `greedy` included - except
// that a `variadic` run also ends at any of `commands`, so that the command it
// names is not collected as one of its values.
// `negatable` names the options whose `--no-` form counts as an occurrence.
// Each step is the span of `args` one argument (and its value) occupies, with
// the options it holds - more than one, for a cluster of shorts.
/** @type {(args: readonly string[], options: NonNullable<ParseArgsConfig['options']>, sets: { negatable: ReadonlySet<string>, commands: ReadonlySet<string> }) => { count: number, steps: LeadingStep[] }} */
export default function leadingOptions(args, options, { negatable, commands }) {
	// a NUL byte is only an error in an argument the root itself parses, and
	// which those are is what is being decided here
	const scanned = args.map((arg) => arg.replaceAll('\0', '\uFFFD'));
	const { out, origins } = needsNormalizing(options)
		? normalizeWithOrigins(scanned, options, commands)
		: { out: scanned, origins: args.map((_, i) => i) };

	const { tokens } = parseArgs({
		args: out,
		// only the arity matters here: whether an option consumes the next token
		options: fromEntries(entries(options).map(([name, { short, type }]) => [
			name,
			{
				type,
				...typeof short === 'string' && { short },
			},
		])),
		allowNegative: true,
		allowPositionals: true,
		strict: false,
		tokens: true,
	});
	/** @type {(token: typeof tokens[number]) => boolean} */
	function isLeading(token) {
		if (token.kind !== 'option') {
			return false;
		}
		// a `--no-` that parseArgs stripped is a negation, unless the option was
		// declared with it as part of its own name
		if (token.rawName !== `--${token.name}` && token.rawName.startsWith('--no-')) {
			return (negatable.has(token.name) && hasOwn(options, token.name))
				|| hasOwn(options, token.rawName.slice(2));
		}
		return hasOwn(options, token.name);
	}
	const stop = tokens.find((token) => !isLeading(token));
	const count = stop ? origins[stop.index] : args.length;

	/** @type {LeadingStep[]} */
	const steps = [];
	tokens.forEach((token) => {
		const start = origins[token.index];
		// a cluster of shorts that ends in one that is not ours is left whole
		if (token.kind !== 'option' || start >= count) {
			return;
		}
		const last = steps[steps.length - 1];
		if (last?.start === start) {
			last.names[last.names.length] = token.name;
		} else {
			if (last) {
				last.end = start;
			}
			steps[steps.length] = {
				start,
				end: count,
				names: [token.name],
			};
		}
	});

	return { count, steps };
}
