/* global browser, chrome */

if (typeof API === "undefined") {
    var API = {};
}

API.Storage = function() {
    
    var localStorage = API.api.storage.local;

    return {
        /**
         * Retrieves an item from the local storage
         * @param string|array key The key or an array of keys to retrieve
         * @returns angular_promise
         */
        get: function(key) {
            return new C_Promise(function(){
                if (API.promise) {
                    localStorage.get(key).then((function(item){
                        /* jshint ignore:start */
                        if (Array.isArray(key)) {
                            this.call_then(item);
                        }

                        else {
                            if (item[key] === undefined) {
                                this.call_error("Data not found");
                            }
                            else {
                                this.call_then(item[key]);
                            }
                        }
                        /* jshint ignore:end */
                    }).bind(this), (function(error){
                        this.call_error(error);
                    }).bind(this));
                }
                else{
                    localStorage.get(key, (function(item){
                        /* jshint ignore:start */
                        if (Array.isArray(key)) {
                            this.call_then(item);
                        }

                        else {
                            if (item[key] === undefined) {
                                this.call_error("Data not found");
                            }
                            else {
                                this.call_then(item[key]);
                            }
                        }
                        /* jshint ignore:end */
                    }).bind(this));
                }
            });
        },

        set: function(key, value) {
            // setting null means "remove this key" — storage backends
            // persist a literal null otherwise, so cleared values never
            // actually went away
            if (value === null) {
                if (API.promise) {
                    return localStorage.remove(key);
                }
                return new C_Promise(function() {
                    localStorage.remove(key, (function(){
                        this.call_then();
                    }).bind(this));
                });
            }
            var o = {};
            o[key] = value;
            
            if (API.promise) {
                return localStorage.set(o);
            }
            else {
                return new C_Promise(function() {
                    localStorage.set(o, (function(){
                        this.call_then();
                    }).bind(this));
                });
            }
        }
        
    };
};