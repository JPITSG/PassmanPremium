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
	var MSG = 'themeChanged';
	var media = window.matchMedia('(prefers-color-scheme: light)');
	var listeners = [];
	/* raw extension API — this file loads before the API wrappers. Used to
	   push preference changes into every other open Passman page: the
	   injected picker/doorhanger frames live in content processes whose
	   localStorage doesn't observe the popup's write while they are open,
	   so without the broadcast they keep the old theme until reopened */
	var runtime = (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) ? browser.runtime : null;

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

	function apply(pref) {
		if (pref !== 'light' && pref !== 'dark' && pref !== 'system') {
			pref = preference();
		}
		var resolved = pref === 'system' ? (media.matches ? 'light' : 'dark') : pref;
		document.documentElement.setAttribute('data-theme', resolved);
	}

	function store(pref) {
		try {
			window.localStorage.setItem(KEY, pref);
		} catch (e) {
			/* ignore — theme just won't persist */
		}
	}

	function notify(pref) {
		for (var i = 0; i < listeners.length; i++) {
			listeners[i](pref);
		}
	}

	window.PassmanTheme = {
		get: preference,
		set: function (pref) {
			store(pref);
			apply(pref);
			notify(pref);
			if (runtime) {
				try {
					/* runtime messages skip the sender, so no echo; a page
					   receiving this must NOT re-broadcast or every other
					   page would answer with a storm of its own */
					runtime.sendMessage(runtime.id, {method: MSG, args: pref}).then(null, function () {});
				} catch (e) {
					/* callback-style API without a Promise — message is
					   still sent, only the rejection guard is skipped */
				}
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

	/* live re-theme when another Passman page changes the preference (the
	   popup's cycle button / settings switch) while this one is open */
	if (runtime && runtime.onMessage && runtime.onMessage.addListener) {
		runtime.onMessage.addListener(function (msg, sender) {
			if (!msg || msg.method !== MSG) {
				return;
			}
			if (sender && sender.id && sender.id !== runtime.id) {
				return;
			}
			var pref = (msg.args === 'light' || msg.args === 'dark') ? msg.args : 'system';
			store(pref);
			apply(pref);
			notify(pref);
		});
	}

	apply();
})();
