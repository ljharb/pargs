import { parseArgs, type ParseArgsConfig as PAC } from 'util';

export type ParseArgsConfig = PAC;

type ParseArgsOptionsConfig = NonNullable<ParseArgsConfig['options']>;

type ParseArgsOptionConfig = ParseArgsOptionsConfig[keyof ParseArgsOptionsConfig];

type EnumOptionConfig<C extends readonly string[] = readonly string[]> = Omit<ParseArgsOptionConfig, 'type'> & {
	type: 'enum';
	choices: C;
};

type NumberOptionConfig = Omit<ParseArgsOptionConfig, 'type' | 'default'> & {
	type: 'number';
	default?: number | readonly number[];
};

type IntegerOptionConfig = Omit<ParseArgsOptionConfig, 'type' | 'default'> & {
	type: 'integer';
	default?: number | readonly number[];
};

export type NegationPolicy = 'exclusive' | 'last-wins';

/** @deprecated a migration aid; see {@link PargsConfig.shorts} */
export type ShortsConfig = boolean | {
	help?: string;
	version?: string;
};

type BooleanOptionConfig = Omit<ParseArgsOptionConfig, 'type'> & { type: 'boolean' };

type StringOptionConfig = Omit<ParseArgsOptionConfig, 'type'> & { type: 'string' };

type ValueOptionConfig = StringOptionConfig | EnumOptionConfig | NumberOptionConfig | IntegerOptionConfig;

type OptionMeta = {
	description?: string;
	placeholder?: string;
	group?: string;
	defaultDescription?: string;
	negation?: NegationPolicy;
};

type ArityKeys = {
	/**
	 * The option takes the next argument as its value even when that argument
	 * looks like an option.
	 *
	 * @deprecated a migration aid, so an existing CLI can keep accepting
	 * `--opt --value`. `util.parseArgs` rejects that as ambiguous and names the
	 * unambiguous spelling in the error - `--opt=--value` - which new code
	 * should use. Note that a greedy option swallows whatever follows it,
	 * `--help` and `--version` included.
	 */
	greedy?: boolean;
};

/**
 * A `boolean` option already has the shape the arity keys exist to produce, so
 * none of them applies to one; declaring one is rejected here as well as at
 * runtime.
 */
type NoArityKeys = {
	greedy?: never;
};

export type PargsOptionConfig =
	| (BooleanOptionConfig & OptionMeta & NoArityKeys)
	| (ValueOptionConfig & OptionMeta & ArityKeys);

export type PositionalConfig = {
	name: string;
	description?: string;
	rest?: boolean;
};

export type DescriptionExample = string | {
	command: string;
	description?: string;
};

export type DescriptionSection = {
	title: string;
	body: string;
};

export type StructuredDescription = {
	summary?: string;
	examples?: readonly DescriptionExample[];
	sections?: readonly DescriptionSection[];
};

export type PargsConfig = Omit<ParseArgsConfig, 'strict' | 'allowPositionals' | 'options'> & {
	options?: {
		readonly [longOption: string]: PargsOptionConfig;
	};
	allowPositionals?: boolean | number;
	minPositionals?: number;
	positionals?: readonly PositionalConfig[];
	description?: string | StructuredDescription;
	negation?: NegationPolicy;
	partialValues?: boolean;
	subcommands?: Readonly<Record<string, PargsConfig>>;
	defaultCommand?: string;
	/**
	 * Override the built-in `--version` output: a string is printed verbatim,
	 * `false` removes the option entirely.
	 *
	 * @deprecated a migration aid, so an existing CLI can keep the exact
	 * `--version` output it already ships. New code should take the default -
	 * the `v`-prefixed version from the nearest `package.json`.
	 */
	version?: boolean | string;
	/**
	 * Register short flags for the reserved `--help`/`--version`.
	 *
	 * @deprecated a migration aid, so an existing CLI can keep the `-h`/`-V`
	 * short flags it already ships. New code should use the long forms, which
	 * are always available.
	 */
	shorts?: ShortsConfig;
	usageOnError?: false | 'stdout' | 'stderr';
};

export type PargsRootConfig = PargsConfig;

export type HelpOptions = {
	/** when `false`, `help()` returns instead of calling `process.exit()`; `process.exitCode` is still set */
	exit?: boolean;
};

/** which path `help()` handled, or `false` if there was nothing to handle */
export type HelpResult = 'version' | 'help' | 'errors' | false;

export type ParseArgsError = NodeJS.ErrnoException & {
	code:
		| 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
		| 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE'
		| 'ERR_INVALID_ARG_TYPE'
		| 'ERR_INVALID_ARG_VALUE'
		| 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL'
};

type Token = NonNullable<ReturnType<typeof parseArgs>['tokens']>[number];

export type OptionToken = Extract<Token, { kind: 'option' }>;

// Get the base value type for an option (before considering multiple)
type BaseValueType<O extends PargsOptionConfig> =
	O extends EnumOptionConfig<infer C>
		? C[number]
		: O extends { type: 'number' | 'integer' }
			? number
			: O extends { type: 'string' }
				? string
				: O extends { type: 'boolean' }
					? boolean
					: string | boolean;

// Get the full value type for an option (considering multiple)
type OptionValueType<O extends PargsOptionConfig> =
	O extends { multiple: true }
		? BaseValueType<O>[]
		: BaseValueType<O>;

// Check if an option has a default value
type HasDefault<O> = O extends { default: any } ? true : false;

// Did the config declare its own `version` option? Checked by key presence, since
// the declaration is optional and so does not extend `{ version: unknown }`.
type HasVersionOption<T> = T extends { options: infer O }
	? 'version' extends keyof O ? true : false
	: false;

// `help` is always added. `version` is too, unless the config opted out of it, or
// declared its own `version` option - in which case that option's own type governs,
// and intersecting `{ version: boolean }` on top would reduce `values` to `never`.
type ReservedValues<T> = { help: boolean } & (
	T extends { version: false }
		? {}
		: HasVersionOption<T> extends true
			? {}
			: { version: boolean }
);

// Build the values type from options config
type ValuesFromOptions<Options extends Record<string, PargsOptionConfig> | undefined, T = unknown> =
	Options extends Record<string, PargsOptionConfig>
		? {
			// Required options (have default)
			-readonly [K in keyof Options as HasDefault<Options[K]> extends true ? K : never]: OptionValueType<Options[K]>;
		} & {
			// Optional options (no default)
			-readonly [K in keyof Options as HasDefault<Options[K]> extends true ? never : K]?: OptionValueType<Options[K]>;
		} & ReservedValues<T>
		: ReservedValues<T>;

// Build the command result type from subcommands config
type SubcommandParsed<S extends Record<string, PargsConfig>, Root = unknown> = {
	[K in keyof S]: { name: K } & PargsParsed<
		// a subcommand inherits the root `version` unless it declares its own, so the
		// result type has to be built from the config it is actually parsed with
		S[K] extends { version: unknown }
			? S[K]
			: Root extends { version: infer V } ? S[K] & { version: V } : S[K]
	>
}[keyof S];

export type PargsParsed<T extends (PargsConfig | PargsRootConfig)> = (
	T extends PargsRootConfig
		? T['subcommands'] extends infer S extends Record<string, PargsConfig>
			? { command: SubcommandParsed<S, T> }
			: {}
		: {}
) & {
	errors: string[],
	help(options?: HelpOptions): Promise<HelpResult>,
	// under `partialValues`, the error path returns only what survived the loose
	// reparse, which can omit even an option that declared a `default`
	values: T extends { partialValues: true }
		? Partial<ValuesFromOptions<T['options'], T>>
		: ValuesFromOptions<T['options'], T>,
	positionals: string[],
} & (
	T extends { tokens: true } ? { tokens: Token[] } : {}
);

declare function pargs<const C extends PargsRootConfig>(
	entrypointPath: ImportMeta['filename'],
	obj: C,
): Promise<PargsParsed<C>>;

export default pargs;
