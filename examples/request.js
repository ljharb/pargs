var request = require('request');

var $ = require('..');

var res = $(request, 'http://api.openweathermap.org/data/2.5/weather?q=Sankt-Peterburg&units=metric');
var json = $.s(JSON.parse, res.f('body'));
$.s(console.log, "In Sankt-Peterburg %d °C. Welcome", json.f('main').f('temp'));