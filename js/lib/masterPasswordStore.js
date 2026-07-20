/* global API, PAPI, C_Promise */

/**
 * Encrypted-at-rest storage for the remembered master password.
 *
 * The password is AES-encrypted (sjcl, via PAPI) under a random 256-bit
 * device key generated on first use. This keeps the master password out of
 * plaintext on disk — profile backups, sync tools and casual inspection of
 * the storage file no longer expose it directly.
 *
 * Honest limit: the device key lives in the same extension storage, because
 * auto-unlock without any prompt requires a key the extension can read
 * unattended. This is containment, not a hard security boundary — software
 * with full access to this browser profile could still recover the password.
 *
 * Legacy migration: installs that stored `master_password` in plaintext are
 * transparently migrated on first load (encrypted copy written, plaintext
 * cleared).
 */
window.MasterPasswordStore = (function () {
	'use strict';

	var storage = new API.Storage();
	var ENC_KEY = 'master_password_enc';
	var LEGACY_KEY = 'master_password';
	var DEVICE_KEY = 'device_key';

	function generateDeviceKey() {
		var bytes = new Uint8Array(32);
		window.crypto.getRandomValues(bytes);
		var str = '';
		for (var i = 0; i < bytes.length; i++) {
			str += String.fromCharCode(bytes[i]);
		}
		return window.btoa(str);
	}

	function withDeviceKey(callback) {
		function createFresh() {
			var fresh = generateDeviceKey();
			storage.set(DEVICE_KEY, fresh).then(function () {
				callback(fresh);
			});
		}
		storage.get(DEVICE_KEY).then(function (key) {
			if (key) {
				callback(key);
			} else {
				createFresh();
			}
		}).error(createFresh);
	}

	function save(password) {
		withDeviceKey(function (key) {
			storage.set(ENC_KEY, PAPI.encryptString(password, key));
			storage.set(LEGACY_KEY, null);
		});
	}

	function clear() {
		storage.set(ENC_KEY, null);
		storage.set(LEGACY_KEY, null);
	}

	function load() {
		return new C_Promise(function () {
			var promise = this;

			function done(password) {
				promise.call_then(password || null);
			}

			function tryLegacy() {
				storage.get(LEGACY_KEY).then(function (password) {
					if (password) {
						// migrate the old plaintext value to the encrypted form
						save(password);
					}
					done(password);
				}).error(function () {
					done(null);
				});
			}

			storage.get(ENC_KEY).then(function (blob) {
				if (!blob) {
					tryLegacy();
					return;
				}
				storage.get(DEVICE_KEY).then(function (key) {
					var password = null;
					try {
						password = PAPI.decryptString(blob, key);
					} catch (e) {
						// undecryptable blob — drop it and stay locked
						clear();
					}
					done(password);
				}).error(function () {
					done(null);
				});
			}).error(tryLegacy);
		});
	}

	return {
		save: save,
		clear: clear,
		load: load
	};
})();
