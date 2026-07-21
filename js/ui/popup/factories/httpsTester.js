(function () {
    'use strict';

    /**
     * @ngdoc function
     * @name passmanApp.controller:MainCtrl
     * @description
     * # MainCtrl
     * Controller of the passmanApp
     */
    angular.module('passmanExtension').factory('HttpsTest', ['$http', '$q', function ($http, $q) {
        var tester = {};
        tester.test = function (url) {
            var deferred = $q.defer();
            if(url.match(/^https:\/\//)){
                deferred.resolve(url);
                return deferred.promise;
            }
            // http is not supported — never accept it, never downgrade
            if(url.match(/^http:\/\//)){
                deferred.reject();
                return deferred.promise;
            }
            // first test with https — give slow servers a fair chance;
            // 500 ms used to misdetect healthy HTTPS hosts and downgrade
            // them to cleartext http
            var protocol = 'https://';

            var req = {
                method: 'GET',
                url: protocol+url,
                timeout: 5000
            };

            $http(req).then(function () {
                    // we have https
                    deferred.resolve(protocol + url);
                },
                function () {
                    // no https — the caller must not downgrade on its own;
                    // continuing over http is the user's explicit choice
                    deferred.reject();
                });
            return deferred.promise;
        };

        tester.isHTTP = function (url) {
            return url.substr(0,5) === 'http:';
        };

        return tester;
    }]);
}());
