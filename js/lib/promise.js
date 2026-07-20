/**
 * Nextcloud - passman
 *
 * @copyright Copyright (c) 2016, Sander Brand (brantje@gmail.com)
 * @copyright Copyright (c) 2016, Marcos Zuriaga Miguel (wolfi@wolfi.es)
 * @license GNU AGPL version 3 or any later version
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

function C_Promise(workload, context) {
    this.parent = context;

    var thenCallbacks = [];
    var progressCallbacks = [];
    var errorCallbacks = [];
    // the settled result is retained so a handler attached after the
    // workload finished still fires — the old single-slot design silently
    // dropped results (and earlier .then handlers) in that case
    var settled = null;

    function forEach(callbacks, args) {
        for (var i = 0; i < callbacks.length; i++) {
            try {
                callbacks[i].apply(null, args);
            } catch (e) {
                if (callbacks === thenCallbacks && errorCallbacks.length) {
                    // a throwing .then callback fails the promise like a
                    // native one, instead of escaping as an unhandled
                    // rejection inside the caller's own callback
                    forEach(errorCallbacks, [e]);
                } else {
                    throw e;
                }
            }
        }
    }

    function dispatch() {
        if (!settled) {
            return;
        }
        if (settled.type === 'then') {
            forEach(thenCallbacks, settled.args);
        } else {
            forEach(errorCallbacks, settled.args);
        }
    }

    this.then = function (callback) {
        thenCallbacks.push(callback);
        dispatch();
        return this;
    };
    this.progress = function (callback) {
        progressCallbacks.push(callback);
        return this;
    };
    this.error = function (callback) {
        errorCallbacks.push(callback);
        dispatch();
        return this;
    };
    this.call_then = function () {
        settled = {type: 'then', args: Array.prototype.slice.call(arguments)};
        dispatch();
    };
    this.call_progress = function () {
        forEach(progressCallbacks, Array.prototype.slice.call(arguments));
    };
    this.call_error = function () {
        settled = {type: 'error', args: Array.prototype.slice.call(arguments)};
        dispatch();
    };

    // still async, but without the old arbitrary 100 ms penalty — handler
    // registration can no longer be missed, so the delay has no purpose
    setTimeout(workload.bind(this), 0);
}