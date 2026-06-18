const {
	entries,
	keys,
} = Object;

const { isArray } = Array;

/** @import { PargsRootConfig, PargsOptionConfig, PositionalConfig, StructuredDescription } from './index.d.mts' */

/** @type {(value: PargsOptionConfig) => string} */
function valuePlaceholder(value) {
	if (value.type === 'boolean') {
		return '';
	}
	const inner = value.placeholder || (value.type === 'enum' ? value.choices.join('|') : value.type);
	return ` <${inner}>${value.multiple ? '...' : ''}`;
}

/** @type {(value: PargsOptionConfig) => string} */
function formatDefault(value) {
	// `defaultDescription` overrides the shown default (eg, to mask a secret or
	// keep an env-derived value out of the output)
	if (typeof value.defaultDescription === 'string') {
		return ` (default: ${value.defaultDescription})`;
	}
	if (!('default' in value)) {
		return '';
	}
	const { default: def } = value;
	// a boolean defaulting to false is the implicit default; only `default: true` is worth showing
	if (value.type === 'boolean' && def === false) {
		return '';
	}
	return ` (default: ${isArray(def) ? `[${def.join(', ')}]` : String(def)})`;
}

/** @type {(rows: [string, string][], indent: string) => string[]} */
function alignedRows(rows, indent) {
	const width = Math.max(...rows.map(([left]) => left.length));
	return rows.map(([left, right]) => `${indent}${right ? `${left.padEnd(width)}  ${right}` : left}`);
}

// the first line of a (string or structured) description, for compact listings
/** @type {(description: PargsRootConfig['description']) => string} */
function summaryLine(description) {
	const text = typeof description === 'string' ? description : description?.summary || '';
	return `${text}`.split('\n')[0];
}

/** @type {(positionals: readonly PositionalConfig[], min: number) => string[]} */
function usagePositionals(positionals, min) {
	return positionals.map((pos, i) => {
		const inner = `${pos.name}${pos.rest ? '...' : ''}`;
		return i < min ? `<${inner}>` : `[${inner}]`;
	});
}

/** @type {(name: string, config: PargsRootConfig) => string} */
export default function generateHelp(name, config) {
	const {
		options,
		subcommands,
		allowPositionals,
		minPositionals,
		positionals,
		description,
	} = config;

	/** @type {StructuredDescription} */
	const desc = typeof description === 'string' ? { summary: description } : description || {};

	const lines = [];

	if (desc.summary) {
		lines.push(`${desc.summary}`.trim(), '');
	}

	const min = typeof minPositionals === 'number' ? minPositionals : 0;

	const usage = [`Usage: ${name}`];
	if (subcommands) {
		usage.push('<command>');
	}
	usage.push(options && keys(options).length > 0 ? '[options]' : '[--help]');
	if (!subcommands && (allowPositionals || positionals?.length)) {
		if (positionals?.length) {
			usage.push(...usagePositionals(positionals, min));
		} else {
			usage.push(min > 0 ? '<args...>' : '[args...]');
		}
	}
	lines.push(usage.join(' '));

	if (subcommands) {
		lines.push('', 'Commands:');
		const rows = entries(subcommands).map(([command, sub]) => [command, summaryLine(sub.description)]);
		lines.push(...alignedRows(/** @type {[string, string][]} */ (rows), '  '));
	}

	if (!subcommands && positionals?.some((pos) => pos.description)) {
		lines.push('', 'Arguments:');
		const rows = positionals.map((pos) => [pos.name, pos.description || '']);
		lines.push(...alignedRows(/** @type {[string, string][]} */ (rows), '  '));
	}

	// option rows tagged by `group`; the default group ("Options") is rendered
	// first and carries the reserved `--help`
	const optionRows = entries(options ?? {}).map(([key, value]) => {
		const short = value.short ? `-${value.short}, ` : '    ';
		const flag = value.type === 'boolean' ? `--[no-]${key}` : `--${key}`;
		return /** @type {[string, string, string]} */ ([
			value.group || 'Options',
			`${short}${flag}${valuePlaceholder(value)}`,
			`${value.description || ''}${formatDefault(value)}`.trim(),
		]);
	});
	optionRows.push([
		'Options', '    --help', 'Show this help text',
	]);
	if (!(options && 'version' in options)) {
		optionRows.push([
			'Options', '    --version', 'Show the version number',
		]);
	}

	const groupOrder = ['Options'];
	optionRows.forEach(([group]) => {
		if (!groupOrder.includes(group)) {
			groupOrder.push(group);
		}
	});

	const width = Math.max(...optionRows.map(([, flag]) => flag.length));
	groupOrder.forEach((group) => {
		lines.push('', `${group}:`);
		optionRows.filter(([rowGroup]) => rowGroup === group).forEach(([
			, flag, right,
		]) => {
			lines.push(`  ${right ? `${flag.padEnd(width)}  ${right}` : flag}`);
		});
	});

	if (desc.examples?.length) {
		lines.push('', 'Examples:');
		const rows = desc.examples.map((ex) => (typeof ex === 'string' ? [ex, ''] : [ex.command, ex.description || '']));
		lines.push(...alignedRows(/** @type {[string, string][]} */ (rows), '  '));
	}

	(desc.sections || []).forEach((section) => {
		lines.push('', `${section.title}:`);
		`${section.body}`.split('\n').forEach((line) => lines.push(`  ${line}`.trimEnd()));
	});

	return lines.join('\n');
}
