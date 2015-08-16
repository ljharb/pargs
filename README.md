# Pargs
Pargs - promise arguments. It is a utility for work async functions as sync. 
## Install
```bash
npm i pargs
```
## Use
```js
var fs = require('fs');

var $ = require('pargs');
$.onerror = console.error;
var script = $(fs.readFile, __filename, 'utf-8');
var minify = $.sync($.field(script, 'replace'), /\n||\t/g, "");
var done = $(fs.writeFile, __dirname + "/index.min.js", minify);
$.deps.sync(console.log, "done", [done]);
```
## Aliases
* pargs.s = pargs.sync;
* pargs.d = pargs.deps;
* pargs.d.s = pargs.deps.sync;
* pargs.f = pargs.field;
* pargs.a = pargs.array;

## TODO
* Write README docs.
* Write interface for without error async functions