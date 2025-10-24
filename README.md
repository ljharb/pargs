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

Help text is automatically read from a `help.txt` file adjacent to `import.meta.filename`.

`await` an invocation of the `help` function returned from the pargs call to handle `--help` and print the help text if needed, or to print errors and exit.

### Options

See the [node.js parseArgs documentation](https://nodejs.org/api/util.html#utilparseargsconfig) for some context.

 - `strict`: can not be set to `false` - strictness all the way.
 - `allowNegative`: can not be set to `false`.
 - `args`: can not provide; pargs always uses `process.cwd()` - this may be added in the future, though.
 - `options.type`: in addition to `'boolean'` and `'string'`, `'enum'`: when provided, a `choices` string array is also required.
 - `allowPositionals`: in addition to a boolean, or an integer representing the maximum number of allowed positional arguments.
 - `subcommands`: if provided, must be an object. Keys are the subcommand names (eg, in `npm ls`, `ls` is the subcommand), and values are the configuration options for each subcommand - as if they were a top-level invocation.

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
[actions-image]: https://img.shields.io/endpoint?url=https://github-actions-badge-u3jn4tfpocch.runkit.sh/ljharb/pargs
[actions-url]: https://github.com/ljharb/pargs/actions
[@ibakaidov]: https://github.com/ibakaidov
