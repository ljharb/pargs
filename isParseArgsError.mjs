
/** @type {(e: unknown) => e is import('./index.d.mts').ParseArgsError} */
export default function isParseArgsError(e) {
	return !!e
		&& typeof e === 'object'
		&& e instanceof Error
		&& 'code' in e
		&& (
			e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
			|| e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE'
			|| e.code === 'ERR_INVALID_ARG_TYPE'
			|| e.code === 'ERR_INVALID_ARG_VALUE'
			|| e.code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL'
		);
}
