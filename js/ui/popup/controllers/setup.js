/* global API */

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

(function () {
    'use strict';

    /**
     * @ngdoc function
     * @name passmanApp.controller:MainCtrl
     * @description
     * # MainCtrl
     * Controller of the passmanApp
     */
    angular.module('passmanExtension')
        .controller('SetupCtrl', ['$scope', '$timeout', '$location', '$rootScope', 'StepsService', 'HttpsTest',
            function ($scope, $timeout, $location, $rootScope, StepsService, HttpsTest) {
            $scope.settings = {
                nextcloud_host: 'https://',
                nextcloud_username: '',
                nextcloud_password: '',
                // secure-by-default matching: credentials fill only on the
                // scheme and full host they were saved for (http pages and
                // sibling subdomains must not satisfy a match). Path is not
                // an origin boundary, so it stays ignored; every option
                // remains user-configurable in the settings view
                ignoreProtocol: false,
                ignoreSubdomain: false,
                ignorePath: true,
                ignorePort: false,
                generatedPasswordLength: 12,
                remember_password: true,
                vault_password: '',
                refreshTime: 60,
                default_vault: {},
                master_password: '',
                master_password_repeat: '',
                enableAutoFill: true,
                enablePasswordPicker: true,
                enableAutoSubmit: false,
                debug: false,
                accounts: []
            };
            $scope.vaults = [];

            $rootScope.$broadcast('hideHeader');
            $rootScope.setup = true;
            $scope.gogo = function (to) {
                StepsService.steps().goTo(to);
            };

            $scope.check = {
                server: function (callback) {
                    if(!$scope.settings.nextcloud_host || !$scope.settings.nextcloud_username || !$scope.settings.nextcloud_password){
                        $scope.errors.push(API.i18n.getMessage('invalid_server_settings'));
                        callback(false);
                        return;
                    }
                    $scope.settings.nextcloud_host = $scope.settings.nextcloud_host.replace(/\/$/, "");
                    PAPI.host = $scope.settings.nextcloud_host;
                    PAPI.username = $scope.settings.nextcloud_username;
                    PAPI.password = $scope.settings.nextcloud_password;
                    PAPI.getVaults(function (vaults) {
                        if (vaults.hasOwnProperty('error')) {
                            var errors = API.i18n.getMessage('invalid_response_from_server', [vaults.result.status, vaults.result.statusText]);
                            $scope.errors.push(errors);
                            callback(false);
                        }
                        else {
                            $scope.vaults = vaults;
                            // preselect the first vault so the picker never
                            // shows Angular's blank "unknown option"
                            if (vaults.length > 0 && (!$scope.settings.default_vault || !$scope.settings.default_vault.guid)) {
                                $scope.settings.default_vault = vaults[0];
                            }
                            callback(true);
                        }
                        $scope.$apply();
                    });
                },
                vault: function (callback) {
                    var decrypted = '';
                    try {
                        decrypted = PAPI.decryptString($scope.settings.default_vault.challenge_password, $scope.settings.vault_password);
                    }
                    catch (e) {
                        // handled below — anything that yields no plaintext fails
                    }
                    // decryptString returns '' without throwing when the key or
                    // the ciphertext is empty (empty password, or no vault
                    // selected because the server has none) — only a non-empty
                    // result proves the password actually matched
                    if (decrypted) {
                        callback(true);
                    } else {
                        $scope.errors.push(API.i18n.getMessage('invalid_vault_password'));
                        callback(false);
                    }
                },
                master: function (callback) {
                    if($scope.settings.master_password !== $scope.settings.master_password_repeat){
                        $scope.errors.push(API.i18n.getMessage('no_password_match'));
                        callback(false);
                        return;
                    }

                    if ($scope.settings.master_password.trim() !== '') {
                        callback(true);
                    } else {
                        $scope.errors.push(API.i18n.getMessage('empty_master_key'));
                        callback(false);
                    }
                }
            };
            $scope.saving = false;
            $scope.next = function () {
                $scope.saving = true;
                $scope.errors = [];
                $timeout(function () {
                    var step = StepsService.getCurrent().name;
                    var check = $scope.check[step];
                    if (typeof check === "function") {
                        check(function (result) {
                            $scope.saving = false;
                            if (result) {
                                $scope.errors = [];
                                $scope.$apply();
                                StepsService.steps().next();
                            }
                            $timeout(function () {
                                $scope.errors = [];
                                $scope.$apply();
                            }, 5000);
                        });
                    }
                    else {
                        $scope.saving = false;
                        StepsService.steps().next();
                    }
                }, 10);
            };

            $scope.isHTTP = function (url) {
                return HttpsTest.isHTTP(url);
            };

            $scope.checkHost = function () {
                var probed = $scope.settings.nextcloud_host;
                $scope.httpsUnreachable = false;
                HttpsTest.test(probed).then(function (resultUrl) {
                    // the user may have kept typing while the probe ran —
                    // only write back when the field is unchanged
                    if ($scope.settings.nextcloud_host === probed) {
                        $scope.settings.nextcloud_host = resultUrl;
                    }
                }, function () {
                    // HTTPS unreachable — never downgrade silently; falling
                    // back to cleartext http is the user's explicit choice
                    if ($scope.settings.nextcloud_host === probed) {
                        $scope.httpsUnreachable = true;
                    }
                });
            };

            $scope.usePlainHttp = function () {
                if ($scope.settings.nextcloud_host.match(/^https?:\/\//)) {
                    return;
                }
                $scope.settings.nextcloud_host = 'http://' + $scope.settings.nextcloud_host;
                $scope.httpsUnreachable = false;
            };

            $scope.finished = function () {
                var settings = angular.copy($scope.settings);
                var master_password = settings.master_password;
                var master_password_remember = settings.master_password_remember;
                var account = {
                    nextcloud_host: settings.nextcloud_host,
                    nextcloud_username: settings.nextcloud_username,
                    nextcloud_password: settings.nextcloud_password,
                    vault: settings.default_vault,
                    vault_password: settings.vault_password
                };
                settings.accounts.push(account);
                delete settings.master_password;
                delete settings.master_password_remember;
                delete settings.nextcloud_host;
                delete settings.nextcloud_username;
                delete settings.nextcloud_password;
                delete settings.vault_password;
                delete settings.master_password_repeat;
                delete settings.default_vault;

                $scope.saving = true;

                API.runtime.sendMessage(API.runtime.id, {
                    method: "setMasterPassword",
                    args: {password: master_password, savePassword: master_password_remember}
                })
                    .then(function () {
                        return API.runtime.sendMessage(API.runtime.id, {
                            method: "saveSettings",
                            args: settings
                        }).then(function () {
                            setTimeout(function () {
                                // running from a plain setTimeout: update the
                                // scope, restore the header and route to the
                                // list inside a digest, or the popup keeps
                                // showing the spinner forever
                                $rootScope.setup = false;
                                $scope.saving = false;
                                $rootScope.$broadcast('showHeader');
                                API.runtime.sendMessage(API.runtime.id, {
                                    method: "closeSetupTab"
                                });
                                window.location = '#!/';
                                $scope.$apply();
                            }, 750);
                        });
                    })
                    .catch(function () {
                        // persisting the settings failed — stay on the
                        // wizard and say so instead of completing setup
                        $scope.saving = false;
                        $scope.errors.push(API.i18n.getMessage('error'));
                        $scope.$apply();
                    });


            };
        }]);
}());

