import { basename, dirname, join, resolve } from 'path';
import { readFile, realpath } from 'fs/promises';

import generateHelp from './generateHelp.mjs';

/** @import { PargsRootConfig } from './index.d.mts' */

const { entries } = Object;

/** @type {(path: string) => Promise<any>} */
async function readJSON(path) {
	try {
		return JSON.parse(await readFile(path, 'utf-8'));
	} catch {
		return null;
	}
}

// Resolve a command name from a single `package.json`: the `bin` entry whose
// path is the entrypoint, else the (unscoped) package name, else null.
/** @type {(dir: string, pkg: any, realEntrypointPath: string) => Promise<string | null>} */
async function nameFromPkg(dir, pkg, realEntrypointPath) {
	if (pkg.bin && typeof pkg.bin === 'object') {
		const matches = await Promise.all(entries(pkg.bin).map(async ([command, relPath]) => {
			try {
				return await realpath(resolve(dir, `${relPath}`)) === realEntrypointPath ? command : null;
			} catch {
				return null;
			}
		}));
		const match = matches.find((command) => command !== null);
		if (match) {
			return match;
		}
	}
	return pkg.name ? `${pkg.name}`.replace(/^@[^/]+\//, '') : null;
}

// Derive the command name for the generated usage line from the nearest
// `package.json`, falling back to the entrypoint's basename.
/** @type {(realEntrypointPath: string) => Promise<string>} */
async function commandName(realEntrypointPath) {
	let dir = dirname(realEntrypointPath);
	let pkg = null;
	let pkgDir = '';
	while (dir && !pkg) {
		pkgDir = dir;
		pkg = await readJSON(join(dir, 'package.json')); // eslint-disable-line no-await-in-loop
		const parent = dirname(dir);
		dir = parent === dir ? '' : parent;
	}
	return pkg
		? (await nameFromPkg(pkgDir, pkg, realEntrypointPath)) ?? basename(realEntrypointPath)
		: basename(realEntrypointPath);
}

// the `version` from the nearest `package.json`, for the reserved `--version`
/** @type {(realEntrypointPath: string) => Promise<string>} */
export async function getVersion(realEntrypointPath) {
	let dir = dirname(realEntrypointPath);
	while (dir) {
		const pkg = await readJSON(join(dir, 'package.json')); // eslint-disable-line no-await-in-loop
		if (pkg && typeof pkg.version === 'string') {
			return pkg.version;
		}
		const parent = dirname(dir);
		dir = parent === dir ? '' : parent;
	}
	return '';
}

/** @type {(realEntrypointPath: string, config: PargsRootConfig) => Promise<string>} */
export default async function getHelpText(realEntrypointPath, config) {
	try {
		return `${await readFile(join(dirname(realEntrypointPath), './help.txt'), 'utf-8')}`;
	} catch (e) {
		if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'ENOENT') {
			throw e;
		}
		return generateHelp(await commandName(realEntrypointPath), config);
	}
}
