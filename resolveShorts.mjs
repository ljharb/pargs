const {
	entries,
	hasOwn,
	keys,
} = Object;

const { isArray } = Array;

// a subcommand that inherited `shorts` from its parent did not ask for those
// letters itself, so a collision with its own options is not a config error
export const kInheritedShorts = Symbol('pargs: `shorts` was inherited');

const reserved = ['help', 'version'];

const autoShorts = {
	help: 'h',
	version: 'V',
};

// Resolve the short flags for the reserved `--help`/`--version`. `shorts: true`
// requests the conventional `-h`/`-V` and yields silently to any letter an
// option already claims; an explicitly requested letter that collides throws.
/** @type {(config: any) => { help: string | false, version: string | false }} */
export default function resolveShorts(config) {
	const { shorts } = config;
	if (typeof shorts === 'undefined' || shorts === false) {
		return { help: false, version: false };
	}

	const auto = shorts === true;
	if (!auto && (!shorts || typeof shorts !== 'object' || isArray(shorts))) {
		throw new TypeError('Error: `shorts` must be a boolean, or an object');
	}

	const requested = auto ? autoShorts : shorts;
	const unknown = keys(requested).filter((key) => !reserved.includes(key));
	if (unknown.length > 0) {
		throw new TypeError(`Error: \`shorts\` may only contain \`help\` and \`version\`; got ${unknown.map((x) => `\`${x}\``).join(', ')}`);
	}

	const options = config.options ?? {};

	/** @type {Record<string, string>} */
	const claimed = {};
	entries(options).forEach(([name, option]) => {
		// `parseArgs` resolves a duplicated short to the first declaration
		if (option && typeof (/** @type {any} */ (option).short) === 'string' && !hasOwn(claimed, /** @type {any} */ (option).short)) {
			claimed[/** @type {any} */ (option).short] = name;
		}
	});

	const inherited = !!config[kInheritedShorts];
	const noVersion = 'version' in options || config.version === false;

	/** @type {Record<string, string>} */
	const taken = {};
	/** @type {Record<string, string | false>} */
	const resolved = { help: false, version: false };

	reserved.forEach((key) => {
		// an explicitly `undefined` request is "absent", so that spreading an optional
		// field is not a startup error - the same rule `version` and the option configs
		// already follow
		if (!hasOwn(requested, key) || typeof requested[key] === 'undefined') {
			return;
		}
		const short = requested[key];
		// `parseArgs` measures a short by UTF-16 length, so an astral character is
		// rejected here rather than escaping as a parse error later
		if (typeof short !== 'string' || short.length !== 1) {
			throw new TypeError(`Error: \`shorts.${key}\` must be a single character`);
		}
		if (key === 'version' && noVersion) {
			// a letter this level did not ask for by name - `shorts: true`, or a
			// request inherited from a parent - yields rather than failing, since
			// the conflict was not written in one place
			if (auto || inherited) {
				return;
			}
			throw new TypeError('Error: `shorts.version` is not allowed when there is no built-in `--version`');
		}
		if (hasOwn(taken, short)) {
			throw new TypeError(`Error: \`shorts.${key}\` and \`shorts.${taken[short]}\` both request \`-${short}\``);
		}
		if (hasOwn(claimed, short)) {
			if (auto || inherited) {
				return;
			}
			throw new TypeError(`Error: \`shorts.${key}\` requests \`-${short}\`, which \`--${claimed[short]}\` already uses`);
		}
		taken[short] = key;
		resolved[key] = short;
	});

	return { help: resolved.help, version: resolved.version };
}
