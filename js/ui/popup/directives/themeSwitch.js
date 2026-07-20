/**
 * Nextcloud - passman
 *
 * Theme preference control (system / light / dark). Persists through
 * js/lib/theme.js so the popup and the injected frames stay in sync.
 *
 * @license GNU AGPL version 3 or any later version
 */
(function () {
	'use strict';

	angular.module('passmanExtension')
		.directive('themeSwitch', ['$timeout', function ($timeout) {
			return {
				restrict: 'E',
				template: '<div class="segmented theme-seg">' +
					'<button type="button" ng-repeat="opt in options" ' +
					'ng-class="{active: current === opt.value}" ' +
					'ng-click="set(opt.value)">{{opt.labelKey | translate}}</button>' +
					'</div>',
				link: function (scope) {
					scope.options = [
						{value: 'system', labelKey: 'theme_system'},
						{value: 'light', labelKey: 'theme_light'},
						{value: 'dark', labelKey: 'theme_dark'}
					];
					scope.current = window.PassmanTheme ? window.PassmanTheme.get() : 'system';
					scope.set = function (value) {
						scope.current = value;
						if (window.PassmanTheme) {
							window.PassmanTheme.set(value);
						}
					};
					// stay in sync with the header theme toggle
					if (window.PassmanTheme) {
						var unsubscribe = window.PassmanTheme.onChange(function (pref) {
							$timeout(function () {
								scope.current = pref;
							});
						});
						scope.$on('$destroy', unsubscribe);
					}
				}
			};
		}]);
}());
