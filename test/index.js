var fs = require('fs');

var $ = require('../');
$.onerror = console.error;
var script = $(fs.readFile, __filename, 'utf-8');
var minify = $.s(script.f('replace'), /\n||\t/g, "");
var done = $(fs.writeFile, __dirname + "/index.min.js", minify);
$.d.s(console.log, "done", [done])