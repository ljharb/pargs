import { parseArgs, type ParseArgsConfig as PAC } from 'util';

export type ParseArgsConfig = PAC;

type ParseArgsOptionsConfig = NonNullable<ParseArgsConfig['options']>;

type ParseArgsOptionConfig = ParseArgsOptionsConfig[keyof ParseArgsOptionsConfig];

export type PargsConfig = Omit<ParseArgsConfig, 'args' | 'strict' | 'allowPositionals' | 'options'> & {
	options?: {
		[longOption: string]: ParseArgsOptionConfig | (Omit<ParseArgsOptionConfig, 'type'> & {
			type: 'enum';
			choices: string[];
		});
	};
	allowPositionals?: boolean | number;
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

export type OptionToken = Extract<
	NonNullable<ReturnType<typeof parseArgs>['tokens']>[number],
	{ kind: 'option' }
>;

export type PargsParsed<T extends (PargsConfig | PargsRootConfig)> = (
	T extends PargsRootConfig ? {
		command: { name: keyof T['subcommands'] } & PargsParsed<PargsConfig>,
	} : {}
) & {
	errors: string[],
	help(): Promise<void>,
} & ReturnType<typeof parseArgs>;

declare function pargs<C extends PargsRootConfig>(
	entrypointPath: ImportMeta['filename'],
	obj: C,
): Promise<PargsParsed<C>>;

export default pargs;
