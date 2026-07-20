/* Theme preference (system / light / dark) shared by every Passman UI
   surface: the toolbar popup and the injected doorhanger, password-picker
   and auto-login frames. All of them are extension pages on the same
   origin, so a synchronous localStorage read lets us set data-theme
   before first paint — no flash of the wrong theme.

   The stylesheets default to dark; `data-theme="light"` flips the
   neutral surfaces. "system" resolves through prefers-color-scheme and
   re-resolves live when the OS scheme changes. */
(function () {
	'use strict';

	var KEY = 'passman_theme';
	var media = window.matchMedia('(prefers-color-scheme: light)');
	var listeners = [];

	function preference() {
		var value = null;
		try {
			value = window.localStorage.getItem(KEY);
		} catch (e) {
			/* storage can be unavailable in partitioned third-party frames —
			   fall back to following the OS scheme */
		}
		return (value === 'light' || value === 'dark') ? value : 'system';
	}

	function apply() {
		var pref = preference();
		var resolved = pref === 'system' ? (media.matches ? 'light' : 'dark') : pref;
		document.documentElement.setAttribute('data-theme', resolved);
	}

	window.PassmanTheme = {
		get: preference,
		set: function (pref) {
			try {
				window.localStorage.setItem(KEY, pref);
			} catch (e) {
				/* ignore — theme just won't persist */
			}
			apply();
			for (var i = 0; i < listeners.length; i++) {
				listeners[i](pref);
			}
		},
		/* subscribe to preference changes; returns an unsubscribe function */
		onChange: function (fn) {
			listeners.push(fn);
			return function () {
				var i = listeners.indexOf(fn);
				if (i > -1) {
					listeners.splice(i, 1);
				}
			};
		}
	};

	if (media.addEventListener) {
		media.addEventListener('change', function () {
			if (preference() === 'system') {
				apply();
			}
		});
	}

	apply();
})();
