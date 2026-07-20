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
        .controller('SettingsCtrl', ['$scope', '$routeParams', function ($scope, $routeParams) {
            $scope.settings = {
                accounts: [],
                ignoreProtocol: true,
                ignoreSubdomain: true,
                ignorePort: true,
                ignorePath: true,
                generatedPasswordLength: 12,
                remember_password: true,
                refreshTime: 60,
                debug: false
            };
            $scope.errors = [];

            // digits only — anything else typed or pasted into the
            // refresh interval is stripped on the fly
            $scope.$watch('settings.refreshTime', function (val) {
                if (typeof val === 'string' && /[^0-9]/.test(val)) {
                    $scope.settings.refreshTime = val.replace(/[^0-9]/g, '');
                }
            });

            $scope.tabActive =  ($routeParams.tab) ? parseInt($routeParams.tab) : 1;
            $scope.extension = API.runtime.getManifest().name + ' ' + API.runtime.getManifest().version;

            API.runtime.sendMessage(API.runtime.id, {'method': 'getRuntimeSettings'}).then(function (settings) {
                $scope.errors = [];
                if (settings) {
                    $scope.settings = angular.copy(settings);
                }
                $scope.$apply();
            });

            $scope.saving = false;
            $scope.saveSettings = function (redirect) {
                $scope.errors = [];
                var settings = angular.copy($scope.settings);
                // the refresh interval is stored as a non-negative integer
                // — 0 disables the background refresh ticker
                settings.refreshTime = parseInt(settings.refreshTime, 10);
                if (isNaN(settings.refreshTime) || settings.refreshTime < 0) {
                    settings.refreshTime = 0;
                }
                $scope.saving = true;
                API.runtime.sendMessage(API.runtime.id, {method: "saveSettings", args: settings}).then(function () {
                    setTimeout(function () {
                        if(redirect) {
                            window.location = '#!/';
                        }
                        $scope.saving = false;
                        $scope.$apply();
                    }, 750);
                }).catch(function () {
                    // a background failure must never leave the button dead
                    $scope.saving = false;
                    $scope.errors.push(API.i18n.getMessage('error'));
                    $scope.$apply();
                });
            };

            $scope.removeSite = function (site) {
                var idx = $scope.settings.ignored_sites.indexOf(site);
                $scope.settings.ignored_sites.splice(idx, 1);
            };

            $scope.ignoreSite = '';
            $scope.addSite = function (site) {
                site = (site || '').trim();
                // don't store blank entries — an empty entry matches every
                // site and would suppress Passman everywhere
                if (site && $scope.settings.ignored_sites.indexOf(site) === -1) {
                    $scope.settings.ignored_sites.push(site);
                }
                $scope.ignoreSite = '';
            };

            $scope.removeAccount = function (account) {
                var idx = $scope.settings.accounts.indexOf(account);
                if (idx === -1) {
                    return;
                }
                $scope.settings.accounts.splice(idx, 1);

                // last account removed — return the extension to its
                // first-run state, exactly as if it was never configured
                if ($scope.settings.accounts.length === 0) {
                    API.runtime.sendMessage(API.runtime.id, {method: 'resetSettings'}).then(function () {
                        window.location = '#!/setup';
                    });
                    return;
                }

                // the default vault must always belong to a remaining account
                if ($scope.settings.default_vault && account.vault &&
                    $scope.settings.default_vault.guid === account.vault.guid) {
                    $scope.settings.default_vault = $scope.settings.accounts[0].vault;
                }
                $scope.saveSettings(false);
            };

            $scope.cancel = function () {
                window.location = '#!/';
            };
            $scope.addAccount = function () {
                window.location = '#!/accounts/add';
            };

            $scope.openAccount = function (account) {
                if (!account.nextcloud_host) {
                    return;
                }
                var url = account.nextcloud_host;
                if (!/^[a-z][a-z0-9+.\-]*:/i.test(url)) {
                    url = 'https://' + url;
                }
                API.tabs.create({url: url}).then(function () {
                    window.close();
                }).catch(function () {
                    // Firefox refuses non-web schemes (javascript:, data:)
                    // — nothing to open, and no reason to die noisily
                });
            };
        }]);
}());

