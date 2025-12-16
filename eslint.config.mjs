import nodeConfig from '@ljharb/eslint-config/flat/node/20';

export default [
	...nodeConfig,
	{
		rules: {
			complexity: 0,
			'func-style': 0,
			'max-lines-per-function': 0,
			'max-statements': 0,
			'multiline-comment-style': 0,
			'no-extra-parens': 0,
			'sort-keys': 0,
		},
	},
];
