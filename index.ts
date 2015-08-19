var async = require('async');
var Promise = require("promise");

class Argument {
        constructor(promise, onerror=false) {
            this.promise=(new Promise(promise));
            if (onerror) this.promise.catch(onerror);

            this.promise.then((value) => {
                return this.value = value;
            });
        }
        field (name){
            return entry.field(this, name);
        }
        f=this.field
    };


/**
 * @function pargs
 * @param func {function or parg} async function
 * @param [...args] args for call function, if among arguments will be parg (Abstruction argument), then pargs will wait to get it..
 * @return {parg}
*/
var entry = function (func, ...args) {
    var onerror = entry.onerror;
    if (func instanceof Argument) {
        return entry(function (func, args, callback) {
            args.push(callback);
            func.apply(this, args);
        }, func, args);
    }
    var needwait = args.filter(function (arg) {
        return arg instanceof Argument;
    });

    var call = function () {
        return new Argument(function (resolve, reject) {
            var callback = function (error, result) {
                if (error) return reject(error);
                resolve(result);
            };
            args.push(callback);
            func.apply(this, args);
        }, onerror);
    };

    if (needwait.length === 0) {

        return call();
    }

    return new Argument(function (resolve, reject) {
        async.map(needwait, function (arg, cb) {
            arg.promise.then(function (result) {
                cb(null, result);
            }).catch(cb);
        }, function (error, results) {
            results.map(function (arg, index) {
                args[args.indexOf(needwait[index])] = arg;
            });
            call().promise.then(resolve).catch(reject);

        });
    }, onerror);

};

/**
 * @function pargs.sync
 * This function work as main pargs funciton, only first argument is sync function.
 */
entry.sync = function () {
    var func = arguments[0];
    if (func instanceof Argument) {
        var args = [].slice.apply(arguments);
        args.shift();
        return entry.sync(function (func, args) {
            return func.apply(this, args);
        }, func, args);
    }
    arguments[0] = function (...args) {

        var callback = args.pop();
        try {
            callback(null, func.apply(this, args))
        } catch (error) {
            callback(error);
        }

    };
    return entry.apply(this, arguments);
};
/**
 * @function pargs.withoutError
 * @param func {function or parg} async function, who doesn't push error or null in callback
 * @returns {function} normal function.
 */


entry.withoutError = function(func){
    if(func instanceof Argument){
        return entry.s(function(func){
            return entry.we(func);
        }, func);
    }
  return function(...args){
      var callback = args.pop();
      args.push(function(result){
         callback(null, result);
      });
      func.apply(null, args);
  };
};
/**
 * @function pargs.deps
 * Functon as pargs main function, only last argument is array of deps, pagrs will wait them too, but the function itself will not be transmitted.
 */

entry.deps = function(...args){

    var deps = args.pop();
    var handler = function(){
        entry.apply(null, args);
    };
    deps.unshift(handler);
    entry.apply(null, deps);
};
/**
 * @function pargs.deps.sync
 */
entry.deps.sync = function(...args){

    var deps = args.pop();
    var handler = function(){
        entry.sync.apply(null, args);
    };
    deps.unshift(handler);
    entry.apply(null, deps);
};
/**
 * @function pargs.field
 * You can use parg.field(name)
 * @param object {parg}
 * @param name
 * @returns {parg} field by name in object
 */

entry.field = function(object, name){
    return entry.s(function(obj){
        return ('function' === typeof obj)?obj[name].bind(obj):obj[name];
    }, object);
};
/**0
 * @function pargs.array
 * create parg, who wait all elements in array
 * @param array {array or parg}
 * @returns {parg}
 */

entry.array = function (array){
    if (array instanceof Argument){
     return    entry(function(array, callback){
            entry.s(function(arr){
                return callback(null, arr);
            },entry.a(array));
        }, array);
    }
    array.unshift(function(...args){
       return args;
    });
    return entry.s.apply(null, array);
};

entry.s = entry.sync;
entry.d = entry.deps;
entry.d.s=entry.d.sync;
entry.f = entry.field;
entry.a = entry.array;
entry.we = entry.withoutError;

module.exports = entry;
