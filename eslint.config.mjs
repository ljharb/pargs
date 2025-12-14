import baseConfig from '@ljharb/eslint-config/flat/node/20';
import testsConfig from '@ljharb/eslint-config/flat/tests'; // TODO: remove when flat config includes tests override

export default [
	...baseConfig,
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
	...testsConfig.map((config) => ({
		...config,
		files: ['test/**'],
	})),
];
