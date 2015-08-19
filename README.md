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
var minify = $.s(script.f('replace'), /\n||\t/g, "");
var done = $(fs.writeFile, __dirname + "/index.min.js", minify);
$.d.s(console.log, "done", [done]);
```
Other examples in examples directory.
For run examples you need install devDependencies. (npm i in the module dir)
## Aliases
* pargs.s = pargs.sync;
* pargs.d = pargs.deps;
* pargs.d.s = pargs.deps.sync;
* pargs.f = pargs.field;
* pargs.a = pargs.array;
## API
## pargs(func, [...args])

### Params:

* **** *func* {function or parg} async function
* **** *[...args]* args for call function, if among arguments will be parg (Abstruction argument), then pargs will wait to get it..

### Return:

* **parg** 

## pargs.sync 
This function work as main pargs funciton, only first argument is sync function.

## pargs.withoutError

### Params:

* **** *func* {function or parg} async function, who doesn't push error or null in callback

### Return:

* **function** normal function.

## pargs.deps 
Functon as pargs main function, only last argument is array of deps, pagrs will wait them too, but the function itself will not be transmitted.

## pargs.deps.sync

## pargs.field 
You can use parg.field(name)

### Params:

* **** *object* {parg}
* **** *name* 

### Return:

* **parg** field by name in object

## pargs.array 
create parg, who wait all elements in array(array)

### Params:

* **** *array* {array or parg}

### Return:

* **parg** 

## TODO
* Write interface for without error async functions