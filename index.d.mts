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
	default?: number | number[];
};

type IntegerOptionConfig = Omit<ParseArgsOptionConfig, 'type' | 'default'> & {
	type: 'integer';
	default?: number | number[];
};

type PargsOptionConfig = ParseArgsOptionConfig | EnumOptionConfig | NumberOptionConfig | IntegerOptionConfig;

export type PargsConfig = Omit<ParseArgsConfig, 'args' | 'strict' | 'allowPositionals' | 'options'> & {
	options?: {
		[longOption: string]: PargsOptionConfig;
	};
	allowPositionals?: boolean | number;
	minPositionals?: number;
};

export type PargsRootConfig = PargsConfig & {
	subcommands?: Record<string, PargsConfig>
};

export type ParseArgsError = (Error | TypeError) & {
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

// Build the values type from options config
type ValuesFromOptions<Options extends Record<string, PargsOptionConfig> | undefined> =
	Options extends Record<string, PargsOptionConfig>
		? {
			// Required options (have default)
			-readonly [K in keyof Options as HasDefault<Options[K]> extends true ? K : never]: OptionValueType<Options[K]>;
		} & {
			// Optional options (no default)
			-readonly [K in keyof Options as HasDefault<Options[K]> extends true ? never : K]?: OptionValueType<Options[K]>;
		} & {
			// help is always added
			help: boolean;
		}
		: {
			help: boolean;
		};

// Build the command result type from subcommands config
type SubcommandParsed<S extends Record<string, PargsConfig>> = {
	[K in keyof S]: {
		name: K;
		errors: string[];
		help(): Promise<void>;
		values: ValuesFromOptions<S[K]['options']>;
		positionals: string[];
	}
}[keyof S];

export type PargsParsed<T extends (PargsConfig | PargsRootConfig)> = (
	T extends PargsRootConfig
		? T['subcommands'] extends infer S extends Record<string, PargsConfig>
			? { command: SubcommandParsed<S> }
			: {}
		: {}
) & {
	errors: string[],
	help(): Promise<void>,
	values: ValuesFromOptions<T['options']>,
	positionals: string[],
} & (
	T extends { tokens: true } ? { tokens: Token[] } : {}
);

declare function pargs<const C extends PargsRootConfig>(
	entrypointPath: ImportMeta['filename'],
	obj: C,
): Promise<PargsParsed<C>>;

export default pargs;
