import { stripVTControlCharacters } from 'util';

/** @type {(str: string) => string} */
export default function maybeStripColors(str) {
	if ('NO_COLOR' in process.env || !process.stdout.isTTY) {
		return stripVTControlCharacters(str);
	}
	return str;
}
