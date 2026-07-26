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
        .controller('MainCtrl', ['$scope', 'Settings', '$rootScope', '$timeout', function ($scope, Settings, $rootScope, $timeout) {
            // keyboard activation for role-annotated div/span controls:
            // Enter or Space acts like a click, once, app-wide
            document.addEventListener('keydown', function (e) {
                if ((e.which === 13 || e.which === 32) && e.target.closest) {
                    var control = e.target.closest('[role="button"], [role="tab"]');
                    if (control) {
                        e.preventDefault();
                        control.click();
                    }
                }
            });

            var port = API.runtime.connect(null, {
                name: "PassmanCommunication"
            });


            var manualRefresh = false;
            var wasLoading = false;
            var messageParser = function (message) {
                if (!message || message.type !== 'credential_state') {
                    return;
                }
                // Port messages arrive outside Angular's digest, and the
                // background pushes one the instant the port connects — which
                // can land while the very first digest is still running.
                // $timeout schedules one instead of asserting there is none.
                $timeout(function () {
                    var loadFinished = wasLoading && !message.loading;
                    wasLoading = message.loading;
                    $scope.credential_amount = message.count;
                    $scope.refreshing_credentials = message.loading;
                    if (loadFinished) {
                        // A load can now finish while the popup is open (the
                        // staleness top-up), so the view showing credentials
                        // has to re-read them — otherwise the header count
                        // and the list below it disagree.
                        $rootScope.$broadcast('credentialsUpdated');
                    }
                    if (manualRefresh && !message.loading) {
                        manualRefresh = false;
                        // green flash in the subtitle, same channel as the
                        // credential saved/updated feedback — but a refresh
                        // that never reached the server is not a success
                        $rootScope.$broadcast('status', API.i18n.getMessage(
                            message.lastLoadFailed ? 'error' : 'credentials_refreshed'
                        ));
                    }
                });
            };

            /**
             * The background pushes its state as soon as the port connects,
             * and again whenever a load starts or settles, so there is
             * nothing to poll for. This only re-asks for the current value
             * at the moments the popup changes what it is showing.
             */
            var requestCredentialCount = function () {
                try {
                    port.postMessage("credential_amount");
                } catch (e) {
                    // the popup (and with it the port) is already gone
                }
            };

            /**
             * Connect to the background service
             */
            var initApp = function () {
                API.runtime.sendMessage(API.runtime.id, {method: "getMasterPasswordSet"}).then(function (isPasswordSet) {
                    //First check attributes
                    if (!isPasswordSet) {
                        return;
                    }
                    requestCredentialCount();
                });
            };
            port.onMessage.addListener(messageParser);


            $scope.theme = (window.PassmanTheme) ? window.PassmanTheme.get() : 'system';
            $scope.cycleTheme = function () {
                var order = ['system', 'light', 'dark'];
                var next = order[(order.indexOf($scope.theme) + 1) % order.length];
                if (window.PassmanTheme) {
                    window.PassmanTheme.set(next);
                }
            };
            if (window.PassmanTheme) {
                window.PassmanTheme.onChange(function (pref) {
                    $timeout(function () {
                        $scope.theme = pref;
                    });
                });
            }

            // null until the background reports, so the subtitle shows a
            // placeholder rather than a "0 credentials loaded" that was never
            // true. The background answers from memory the moment the port
            // connects, so this lasts a frame or two.
            $scope.credential_amount = null;
            $scope.refreshing_credentials = false;
            $scope.refresh = function () {
                manualRefresh = true;
                $scope.refreshing_credentials = true;
                // A refresh while one is already running joins it rather than
                // starting a second. Either way the background broadcasts the
                // new count and clears the loading flag when it settles, so
                // there is nothing to time here.
                API.runtime.sendMessage(API.runtime.id, {method: "getCredentials"});
            };

            $scope.menuIsOpen = false;
            $scope.bodyOverflow = false;
            $scope.showHeader = true;

            $scope.toggleMenu = function () {
                $scope.menuIsOpen = !$scope.menuIsOpen;
                $scope.bodyOverflow = true;
                $timeout(function () {
                    $scope.bodyOverflow = false;
                }, 1500);
            };

            $rootScope.$on('hideHeader', function () {
                $scope.showHeader = false;
            });

            $rootScope.$on('showHeader', function () {
                // fired after unlock and after finishing setup — the header
                // is appearing for the first time, so ask for the state it
                // should be showing
                $scope.showHeader = true;
                requestCredentialCount();
            });

            // quiet inline feedback, ProxyManager-style: controllers
            // broadcast 'status' and the header subtitle shows it briefly
            var statusRevert = null;
            $scope.status_message = null;
            $rootScope.$on('status', function (event, text) {
                $timeout(function () {
                    $scope.status_message = text;
                });
                if (statusRevert) {
                    $timeout.cancel(statusRevert);
                }
                statusRevert = $timeout(function () {
                    $scope.status_message = null;
                }, 2500);
            });

            API.runtime.sendMessage(API.runtime.id, {'method': 'getRuntimeSettings'}).then(function (settings) {
                // nothing reads these settings off $rootScope — don't park
                // the decrypted account secrets there in the first place
                if (!settings || Object.keys(settings).length === 0) {
                    window.location = '#!/setup';
                } else if (settings.hasOwnProperty('isInstalled')) {
                    window.location = '#!/locked';
                } else {
                    initApp();
                }
            });


            $scope.goto = function (page) {
                // the list view lives at the root route — navigating to
                // '#!/list' would bounce through the otherwise-redirect and
                // needlessly reload the view (and its empty state)
                window.location = '#!/' + (page === 'list' ? '' : page);
                $scope.menuIsOpen = false;
            };


            $scope.lockExtension = function () {
                API.runtime.sendMessage(API.runtime.id, {
                    method: "setMasterPassword",
                    args: {password: null}
                }).then(function () {
                    window.location = '#!/locked';
                });
            };
        }]);
}());

