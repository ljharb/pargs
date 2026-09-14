# pargs <sup>[![Version Badge][npm-version-svg]][package-url]</sup>

[![github actions][actions-image]][actions-url]
[![coverage][codecov-image]][codecov-url]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]

[![npm badge][npm-badge-png]][package-url]

A wrapper for node’s built-in `util.parseArgs` with helpful features added.

## Usage

```js
#!/usr/bin/env node

import pargs from 'pargs';

const {
    help,
    positionals,
    values,
    errors, // a mutable string array; push to it and pargs will include your error messages.
    name, // if subcommands are used
    tokens,
} = await pargs(import.meta.filename, options);

// do extra validation here

await help(); // to handle `--help` and print the help text if needed, or to print errors and exit
```

### Help

Help text is automatically read from a `help.txt` file adjacent to `import.meta.filename`, when one is present.

When no `help.txt` file exists, help text is generated automatically from the provided config - the usage line, options (with their types, choices, defaults, and short flags), subcommands, and positional argument requirements. A `help.txt` file, when present, always takes precedence over the generated text.

The program name in the generated usage line comes from the nearest `package.json` (the `bin` entry that points at the entrypoint, falling back to the unscoped package `name`, then to the file’s basename).

The following config fields exist solely to enrich generated help; they are ignored by `util.parseArgs`:

 - `options[name].description`: a string describing the option.
 - `options[name].placeholder`: the value placeholder shown for a non-boolean option (eg, `placeholder: 'MM/DD/YYYY'` renders `--before <MM/DD/YYYY>` instead of `<string>`).
 - `options[name].group`: a heading to group the option under; ungrouped options appear first under `Options`, and `--help` is always listed there.
 - `options[name].defaultDescription`: a string shown as the default in place of the actual `default` value - useful to mask a secret, or to show an env-derived default symbolically (eg, `$HOME/.cache` rather than the resolved path).
 - `positionals`: an array of `{ name, description?, rest? }`, used to name positionals in the usage line (`<name>` when required per `minPositionals`, else `[name]`; `rest: true` makes it variadic) and to render an `Arguments:` section.
 - `description` (on a config or subcommand): either a string (used as the summary), or an object `{ summary?, examples?, sections? }`, where `examples` is an array of strings or `{ command, description? }`, and `sections` is an array of `{ title, body }` for free-form blocks (eg, `Behavior`, `Exit codes`).

Option defaults are shown as `(default: …)`, except that a boolean option’s `default: false` is omitted (it is the implicit default; `default: true` is still shown). Array defaults render as `[a, b]` / `[]`.

`await` an invocation of the `help` function returned from the pargs call to handle `--help` and print the help text if needed, or to print errors and exit.

### Version

`--version` is provided automatically: the same `await help()` call handles it, printing the `version` field from the nearest `package.json`, prefixed with `v`, and exiting.

The root `version` config controls it.
It is **deprecated**, and marked `@deprecated` in the types:
it exists so a CLI moving onto pargs can keep the exact `--version` output it already ships, and new code should take the default.

 - `true`, `undefined`, or absent: the `package.json` lookup described above.
 - a string: printed verbatim, with no `v` prefix and no `package.json` lookup - useful to match an existing CLI's output, or to print more than the bare number.
 - `false`: no built-in `--version` at all. It is then an unknown option, and the generated help omits its row.

Subcommands inherit the root `version`: a CLI that has no built-in `--version`, or that prints its own string, means that at every level.
A subcommand may declare its own `version` to override what it inherited.

Unlike `help`, `version` is not reserved - if you define your own `version` option, yours is used instead and the built-in one is not added.
**Note that this means you must print it yourself**; `await help()` will not, and a `--version` it does not own falls through to your program's normal path - including when a `defaultCommand` is what parsed the flag.
Declaring an `options.version` alongside a root `version` of `false` or a string throws, since the two disagree about who owns `--version`;
a root `version` of `true` is the default, so it is accepted and your option wins.
That applies to one level: a subcommand declaring its own `version` option alongside a `version` it merely *inherited* yields to the option instead of throwing, since the two were not written in one place.

### Options

See the [node.js parseArgs documentation](https://nodejs.org/api/util.html#utilparseargsconfig) for some context.

 - `strict`: can not be set to `false` - strictness all the way.
 - `allowNegative`: can not be set to `false`.
 - `shorts`: **deprecated**, and marked `@deprecated` in the types - it exists so a CLI moving onto pargs can keep the `-h`/`-V` short flags it already ships, and new code should use the long forms, which are always available. Opts in to short flags for the reserved `--help`/`--version`. `true` requests the conventional `-h` and `-V`, and silently yields either letter to an option that already claims it (so `-v` can stay yours while `-V` is the built-in version). An object - `{ help?, version? }` - requests specific letters, and *throws* if one collides, since you asked for it by name. Omitted, or `false`, registers nothing, which is the default. `shorts.version` is not allowed when there is no built-in `--version` to attach it to. Subcommands inherit the root `shorts` and may declare their own to override it; an inherited letter that collides with a subcommand's own option is skipped rather than throwing, since the collision was not written in one place.
 - `negation`: `'exclusive'` (the default) reports an error when both `--x` and `--no-x` appear in the same invocation; `'last-wins'` suppresses that error and leaves the parsed value alone, so the last occurrence wins for a scalar boolean, and every occurrence is collected for a `multiple` one. May be set at the root, or per-option (`options[name].negation`) to override the root; it does not inherit into subcommands. The reserved `--help` and `--version` are unaffected - `--no-help` is always an unknown option.
 - `args`: when omitted, pargs uses `process.argv`, with the node binary and the entrypoint filtered out. When provided, it is the argument list, used verbatim - nothing is filtered out of it, each element is coerced with `String`, and a non-array throws. An explicit `args` also governs subcommand and `defaultCommand` routing, and suppresses the `process.argv` mutation that subcommand routing otherwise performs. A subcommand's own `args`, if it declares one, is overridden by the parent's routing.
 - `options.type`: in addition to `'boolean'` and `'string'`:
   - `'enum'`: when provided, a `choices` string array is also required. The value is validated only when one is present - an option that was not passed and has no `default` is not an error. With `multiple`, each element is validated individually.
   - `'number'`: validates the value is a finite number and coerces it from a string.
   - `'integer'`: validates the value is a finite integer and coerces it from a string.
 - `partialValues`: when `true`, a fatal parse error (an unknown option, a missing option argument) returns whatever else parsed cleanly instead of an empty `values`. Only declared options survive, and only when the loosely-parsed value still matches the declared type; `enum` choices and `number`/`integer` coercion are applied as usual, and anything that fails is dropped. `errors` still holds only the single fatal error, `positionals` come from the loose reparse and so do not re-apply the configured positional policy, and an option with a `default` may be missing - so `values` is a partial of its usual type. Defaults to `false`, and does not inherit into subcommands.
 - `allowPositionals`: in addition to a boolean, or an integer representing the maximum number of allowed positional arguments.
 - `minPositionals`: an integer representing the minimum required number of positional arguments.
 - `subcommands`: if provided, must be an object. Keys are the subcommand names (eg, in `npm ls`, `ls` is the subcommand), and values are the configuration options for each subcommand - as if they were a top-level invocation.
 - `defaultCommand`: only allowed alongside `subcommands`; must be the name of one of them. When the first argument is not a recognized subcommand (including when it is a flag, or absent entirely), the full argument list is parsed against this command instead of erroring with `unknown command`. This enables a bare default form (eg, `vers <input>`) to coexist with named subcommands. `--help`/`--version` still apply at the level invoked: a root-level `--help` (no recognized subcommand) shows the root help (the command list), not the default command's help.

## Install
``
```sh
npm install --save pargs
```

## License

MIT

## Thanks

Thanks to [@ibakaidov] for donating the `pargs` package name!

[package-url]: https://npmjs.org/package/pargs
[npm-version-svg]: https://versionbadg.es/ljharb/pargs.svg
[npm-badge-png]: https://nodei.co/npm/pargs.png?downloads=true&stars=true
[license-image]: https://img.shields.io/npm/l/pargs.svg
[license-url]: LICENSE
[downloads-image]: https://img.shields.io/npm/dm/pargs.svg
[downloads-url]: https://npm-stat.com/charts.html?package=pargs
[codecov-image]: https://codecov.io/gh/ljharb/pargs/branch/main/graphs/badge.svg
[codecov-url]: https://app.codecov.io/gh/ljharb/pargs/
[actions-image]: https://img.shields.io/github/check-runs/ljharb/pargs/main
[actions-url]: https://github.com/ljharb/pargs/actions
[@ibakaidov]: https://github.com/ibakaidov
