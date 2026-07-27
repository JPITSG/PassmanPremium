/* global API */

var background = (function () {
    var storage = new API.Storage();
    var _self = this;
    var _window = {};


    // Popup ports. Opening the popup never triggers a server load: the
    // background already holds the credentials, so its state is pushed the
    // moment the popup connects, and again whenever a load starts or
    // settles. The popup therefore never has to guess with timers.
    var popupPorts = [];

    function credentialState() {
        return {
            type: 'credential_state',
            count: local_credentials.length,
            loading: !!loadInFlight,
            lastSuccessfulLoad: lastSuccessfulLoad,
            lastLoadFailed: lastLoadFailed
        };
    }

    function postCredentialState(port) {
        try {
            port.postMessage(credentialState());
        } catch (e) {
            // the popup closed between the lookup and the post
        }
    }

    function broadcastCredentialState() {
        for (var i = 0; i < popupPorts.length; i++) {
            postCredentialState(popupPorts[i]);
        }
    }

    API.runtime.onConnect.addListener(function (port) {
        if (port.name !== 'PassmanCommunication') {
            return;
        }
        popupPorts.push(port);
        port.onDisconnect.addListener(function () {
            var idx = popupPorts.indexOf(port);
            if (idx > -1) {
                popupPorts.splice(idx, 1);
            }
        });
        port.onMessage.addListener(function (msg) {
            if (msg === 'credential_amount') {
                postCredentialState(port);
            }
        });
        // Opening the popup is not itself a reason to hit the server. But if
        // the refresh ticker has demonstrably missed a beat — machine asleep,
        // offline, server down — catch up in the background while the popup
        // immediately shows what is already loaded.
        refreshIfStale();
        postCredentialState(port);
    });

    var master_password = null;

    function getMasterPasswordSet() {
        return (master_password !== null);
    }

    _self.getMasterPasswordSet = getMasterPasswordSet;

    function setMasterPassword(opts) {
        master_password = opts.password;
        if (opts.hasOwnProperty('savePassword') && opts.savePassword === true) {
            // Remembered on user request — stored AES-encrypted under a
            // random device key (see js/lib/masterPasswordStore.js).
            MasterPasswordStore.save(opts.password);
        } else {
            MasterPasswordStore.clear();
        }

        if (opts.password) {
            // Unlocking always starts from an empty list, so this is one of
            // the few moments a load is genuinely required.
            getSettings().then(function () {
                getCredentials();
            });
        } else {
            // Locking: purge every decrypted secret from memory so nothing
            // (search, autofill, context menu) can serve credentials until
            // the master password is entered again. getSettings() re-reads
            // storage and only restores the locked-state flags.
            local_credentials = [];
            mined_data = [];
            doorhangerData = {};
            _self.settings = {isInstalled: 1};
            // Invalidate any load still in flight. Without this its response
            // arrives after the purge and repopulates the credential list
            // behind the lock, leaving decrypted secrets in memory.
            credentialLoadCycle++;
            loadInFlight = null;
            lastSuccessfulLoad = 0;
            lastLoadFailed = false;
            // no point polling a server for a vault we cannot decrypt
            stopRefreshTicker();
            if (window.contextMenu) {
                window.contextMenu.setContextItems([]);
            }
            displayLogoutIcons();
            broadcastCredentialState();
            getSettings();
        }

    }

    _self.setMasterPassword = setMasterPassword;


    var testMasterPasswordAgainst;

    function isMasterPasswordValid(password) {
        // decryptString returns '' without throwing when the key or the
        // ciphertext is empty — never treat that as a successful unlock
        if (!password || !testMasterPasswordAgainst) {
            return false;
        }
        try {
            PAPI.decryptString(testMasterPasswordAgainst, password);
            return true;
        } catch (e) {
            return false;
        }
    }

    _self.isMasterPasswordValid = isMasterPasswordValid;


    var local_credentials = [];
    // Bumped on every getCredentials run, and on lock: callbacks from a
    // superseded run must not touch the live credential list (the newest
    // full load wins), and a load still in flight when the vault is locked
    // must never repopulate it behind the lock.
    var credentialLoadCycle = 0;
    // ms epoch of the last load in which every account answered without an
    // error; 0 = never loaded successfully. This is what makes a silently
    // failing refresh distinguishable from a healthy one, and what the
    // staleness check measures against.
    var lastSuccessfulLoad = 0;
    var lastLoadFailed = false;
    // The load currently running, or null. A second request joins it rather
    // than issuing a duplicate round of requests.
    var loadInFlight = null;
    // Seconds the ticker is currently armed for. Kept so an unrelated
    // settings save no longer tears the interval down and restarts it,
    // which used to push the next refresh back every time anything saved.
    var currentRefreshSeconds = null;
    var encryptedFieldSettings = ['accounts'];
    _self.settings = {};
    _self.ticker = null;
    _self.running = false;
    // Loads and decrypts the stored settings into the runtime. It no longer
    // fetches credentials as a side effect — every caller that genuinely
    // needs fresh data asks for it explicitly, so saving a setting (or
    // ignoring a site) stopped dragging a full vault download behind it.
    // Returns a native promise so those callers can sequence off it.
    function getSettings() {
        // A deferred rather than a wrapper, so the body below keeps its own
        // indentation. The executor runs synchronously, and storage.get is
        // async, so resolveSettings always exists by the time it is called.
        var resolveSettings;
        var ready = new Promise(function (resolve) {
            resolveSettings = resolve;
        });

        storage.get('settings').then(function (_settings) {
            // nothing to apply yet: a fresh profile has no settings key at
            // all, and a just-reset one has an empty object — either way
            // there are no accounts to decrypt. Decrypting the absent
            // field would throw, and the catch below would lock the
            // extension and wipe a just-remembered master password;
            // saveSettings re-runs this once real settings are stored
            if (!_settings || Object.keys(_settings).length === 0 || !_settings.hasOwnProperty('accounts')) {
                resolveSettings();
                return;
            }
            if (!master_password && _settings.hasOwnProperty('accounts') && _settings.accounts.length > 0) {
                _self.settings.isInstalled = 1;
                testMasterPasswordAgainst = _settings.accounts;
                resolveSettings();
                return;
            }

            try {
                for (var i = 0; i < encryptedFieldSettings.length; i++) {
                    var field = encryptedFieldSettings[i];
                    _settings[field] = JSON.parse(PAPI.decryptString(_settings[field], master_password));
                }
            } catch (e) {
                // the active master password no longer matches the stored
                // settings (stale auto-unlock, or settings re-encrypted
                // under another password) — running on would leave the
                // extension half-initialized with no signal, so lock and
                // let the user unlock with the right password
                console.error('Could not decrypt the stored settings, locking the extension', e);
                setMasterPassword({password: null});
                resolveSettings();
                return;
            }

            _self.settings = _settings;

            if (!_self.settings.hasOwnProperty('ignored_sites')) {
                _self.settings.ignored_sites = [];
            }

            if (!_self.settings.hasOwnProperty('no_results_found_tab')) {
                _self.settings.no_results_found_tab = 'list';
            }

            if (!_self.settings.hasOwnProperty('enablePasswordPicker')) {
                _self.settings.enablePasswordPicker = !_self.settings.disablePasswordPicker;
            }

            if (!_self.settings.hasOwnProperty('enableAutoFill')) {
                _self.settings.enableAutoFill = !_self.settings.disableAutoFill;
            }

            if (!_self.settings.hasOwnProperty('enableUpdateUrl')) {
                _self.settings.enableUpdateUrl = true;
            }
            if (!_self.settings.hasOwnProperty('passwordPickerGotoList')) {
                _self.settings.passwordPickerGotoList = false;
            }
            // setup never wrote this one, so it stayed undefined (= port
            // respected) while every sibling matching option defaults true
            if (!_self.settings.hasOwnProperty('ignorePort')) {
                _self.settings.ignorePort = true;
            }

            // pages loaded while the extension was locked never ran their
            // content scripts — the readyState gate fires once and finds
            // no master password. Every unlock funnels through this point
            // with real settings applied, so tell each tab it may start;
            // already-started scripts ignore the message
            API.tabs.query({}).then(function (tabs) {
                for (var i = 0; i < tabs.length; i++) {
                    API.tabs.sendMessage(tabs[i].id, {method: 'extensionUnlocked'}).catch(ignoreSendError);
                }
            });

            armRefreshTicker();
            resolveSettings();

        }).error(function () {
            // no settings stored yet — nothing to apply, but callers still
            // have to be released or they would wait forever
            resolveSettings();
        });

        return ready;
    }

    _self.getSettings = getSettings;

    // The periodic refresh is the primary way credentials stay current, so
    // it is left alone unless the interval itself changed — restarting it on
    // every settings write kept pushing the next refresh further away.
    // refreshTime is user-supplied: guard NaN and floor a live ticker at 30s.
    // 0 means "do not poll", and is honoured literally.
    function armRefreshTicker() {
        var seconds = parseInt(_self.settings.refreshTime, 10);
        if (isNaN(seconds) || seconds <= 0) {
            seconds = 0;
        } else {
            seconds = Math.max(seconds, 30);
        }
        if (seconds === currentRefreshSeconds) {
            return;
        }
        currentRefreshSeconds = seconds;
        if (_self.ticker) {
            clearInterval(_self.ticker);
            _self.ticker = null;
        }
        _self.running = seconds > 0;
        if (seconds > 0) {
            _self.ticker = setInterval(function () {
                getCredentials();
            }, seconds * 1000);
        }
    }

    function stopRefreshTicker() {
        if (_self.ticker) {
            clearInterval(_self.ticker);
            _self.ticker = null;
        }
        _self.running = false;
        currentRefreshSeconds = null;
    }

    // Popup-open safety net. The ticker is the intended refresh path, but it
    // cannot run while the machine is suspended and it silently achieves
    // nothing while the server is unreachable. If the last SUCCESSFUL load is
    // older than two full intervals the ticker has measurably missed a beat,
    // so top up in the background. While the ticker is healthy this never
    // fires, and with polling switched off (refreshTime 0) it stays out of
    // the way entirely — that setting means "do not talk to the server".
    function refreshIfStale() {
        if (!master_password) {
            return;
        }
        if (!currentRefreshSeconds || currentRefreshSeconds <= 0) {
            return;
        }
        var thresholdMs = currentRefreshSeconds * 2 * 1000;
        if (lastSuccessfulLoad && (Date.now() - lastSuccessfulLoad) < thresholdMs) {
            return;
        }
        getCredentials();
    }

    function getRuntimeSettings() {
        return _self.settings;
    }

    _self.getRuntimeSettings = getRuntimeSettings;

    function getSetting(name) {
        return _self.settings[name];
    }

    _self.getSetting = getSetting;

    function saveSettings(settings, cb) {
        if (!settings.hasOwnProperty('ignored_sites')) {
            settings.ignored_sites = [];
        }

        // Captured before the runtime settings are replaced below. Comparing
        // the account list before and after is what lets a save load only a
        // newly added account — and load nothing at all for the saves that
        // leave the accounts alone, which is nearly all of them.
        var previousAccounts = (_self.settings && _self.settings.accounts) ?
            _self.settings.accounts.slice() : [];

        // encrypt a copy, never the live object: the runtime (and callers
        // re-saving _self.settings) keeps plaintext, so the old in-place
        // encryption left encrypted accounts behind until the storage
        // round-trip restored them — a second save in that window
        // double-encrypted accounts and silently emptied the vault
        var storedSettings = Object.assign({}, settings);
        for (var i = 0; i < encryptedFieldSettings.length; i++) {
            var field = encryptedFieldSettings[i];
            storedSettings[field] = PAPI.encryptProfileString(JSON.stringify(settings[field]), master_password);
        }

        //window.settings contains the run-time settings
        _self.settings = settings;


        // persist first, then refresh the runtime from storage — and hand
        // the caller the real outcome instead of an instant ack
        return Promise.resolve(storage.set('settings', storedSettings)).then(function () {
            return getSettings();
        }).then(function () {
            // The only credential work a settings save may cause: pull in an
            // account that was just added, forget one that was just removed.
            // The settings are already persisted here, so a credential load
            // that fails afterwards must not be reported as a failed save —
            // the setup and add-account wizards would tell the user their
            // account was not stored when it was.
            return reconcileAccounts(previousAccounts, _self.settings.accounts || [])
                .catch(function () {});
        });

    }

    _self.saveSettings = saveSettings;

    function resetSettings() {
        var persisted = storage.set('settings', {});
        MasterPasswordStore.clear();
        _self.settings = {};
        local_credentials = [];
        doorhangerData = {};
        mined_data = [];
        testMasterPasswordAgainst = undefined;
        master_password = null;
        // back to first-run state: discard any load in flight and stop
        // polling a server this profile is no longer configured for
        credentialLoadCycle++;
        loadInFlight = null;
        lastSuccessfulLoad = 0;
        lastLoadFailed = false;
        stopRefreshTicker();
        broadcastCredentialState();
        return persisted;
    }

    _self.resetSettings = resetSettings;


    // Identity of an account for credential bookkeeping. Editing an
    // account's host, user or vault yields a different key, so it is
    // correctly treated as the old one going away and a new one arriving.
    function accountKey(account) {
        if (!account) {
            return '';
        }
        return [
            account.nextcloud_host,
            account.nextcloud_username,
            (account.vault && account.vault.guid) ? account.vault.guid : ''
        ].join('|');
    }

    // Decrypts one vault payload into `target`. Returns false when the
    // request itself failed, so the caller can keep what it already had.
    function collectVaultCredentials(account, vault, target) {
        if (!vault || vault.hasOwnProperty('error')) {
            return false;
        }
        var _credentials = vault.credentials || [];
        for (var i = 0; i < _credentials.length; i++) {
            var key = account.vault_password;
            var credential = _credentials[i];
            if (credential.hidden === 1) {
                continue;
            }
            var usedKey = key;
            //Shared credentials are not implemented yet
            if (credential.hasOwnProperty('shared_key') && credential.shared_key) {
                try {
                    usedKey = PAPI.decryptString(credential.shared_key, key);
                } catch (e) {
                    // one corrupt shared_key must not abort the whole
                    // account load — skip that credential
                    continue;
                }
            }
            credential = PAPI.decryptCredential(credential, usedKey);
            credential.account = account;
            if (credential.delete_time === 0) {
                target.push(credential);
            }
        }
        delete vault.credentials;
        return true;
    }

    function collectSharedCredentials(account, credentials, target) {
        for (var i = 0; i < credentials.length; i++) {
            var _shared_credential = credentials[i];
            var _shared_credential_data;
            var sharedKey;
            try {
                sharedKey = PAPI.decryptString(_shared_credential.shared_key, account.vault_password);
                _shared_credential_data = PAPI.decryptSharedCredential(_shared_credential.credential_data, sharedKey);
            } catch (e) {
                // skip the single broken entry, keep the rest of the batch
                continue;
            }
            if (!_shared_credential_data) {
                continue;
            }
            // the same credential shared to several of the user's vaults
            // (or delivered twice) must not appear twice
            if (_shared_credential_data.guid) {
                var isDupe = false;
                for (var d = 0; d < target.length; d++) {
                    if (target[d].guid === _shared_credential_data.guid) {
                        isDupe = true;
                        break;
                    }
                }
                if (isDupe) {
                    continue;
                }
            }
            delete _shared_credential.credential_data;
            _shared_credential_data.acl = _shared_credential;
            _shared_credential_data.acl.permissions = new SharingACL(_shared_credential_data.acl.permissions);
            _shared_credential_data.tags_raw = _shared_credential_data.tags;
            _shared_credential_data.account = account;
            target.push(_shared_credential_data);
        }
    }

    // Loads one account — its own vault, then anything shared with it — into
    // `target`. Resolves false only when the vault request failed: shared
    // credentials are best effort, because a server with the sharing
    // endpoint disabled must not make every load look like a failure (which
    // would leave lastSuccessfulLoad stuck and the staleness check firing
    // on every popup open).
    function loadAccountInto(account, target) {
        return new Promise(function (resolve) {
            PAPI.getVault(account, function (vault) {
                if (!collectVaultCredentials(account, vault, target)) {
                    resolve(false);
                    return;
                }
                if (!account.vault || !account.vault.guid) {
                    resolve(true);
                    return;
                }
                PAPI.getCredendialsSharedWithUs(account, account.vault.guid, function (credentials) {
                    if (credentials && credentials.length) {
                        collectSharedCredentials(account, credentials, target);
                    }
                    resolve(true);
                });
            });
        });
    }

    // Full refresh of every configured account. This is what the periodic
    // ticker, the manual refresh button, unlock and startup all run.
    function getCredentials() {
        if (!master_password) {
            return Promise.resolve();
        }
        // no accounts configured — drop anything stale so removed accounts
        // leave no credentials behind (the loop below would never reassign)
        if (!_self.settings.accounts || _self.settings.accounts.length === 0) {
            local_credentials = [];
            // still unlocked — restore the normal icon with a zero count,
            // otherwise the startup locked icon sticks forever
            updateTabsIcon();
            broadcastCredentialState();
            return Promise.resolve();
        }
        // A refresh already running serves this caller too. The ticker and
        // the refresh button used to fire duplicate rounds of requests at
        // each other, with the loser's results merely discarded afterwards.
        if (loadInFlight) {
            return loadInFlight;
        }

        var cycle = ++credentialLoadCycle;
        var accounts = _self.settings.accounts.slice();
        var tmpList = [];

        loadInFlight = Promise.all(accounts.map(function (account) {
            return loadAccountInto(account, tmpList);
        })).then(function (results) {
            loadInFlight = null;
            // superseded by a newer load, or the vault was locked while this
            // ran — either way these credentials must not reach the live list
            if (cycle !== credentialLoadCycle || !master_password) {
                broadcastCredentialState();
                return;
            }

            // Replace only what actually loaded. An account whose request
            // failed keeps the credentials it already had, so a dropped
            // connection or a restarting server can never empty a working
            // vault; an account that is no longer configured is dropped.
            var loadedByKey = {};
            for (var i = 0; i < accounts.length; i++) {
                loadedByKey[accountKey(accounts[i])] = results[i];
            }
            var retained = local_credentials.filter(function (credential) {
                var key = accountKey(credential.account);
                return Object.prototype.hasOwnProperty.call(loadedByKey, key) && !loadedByKey[key];
            });
            local_credentials = retained.concat(tmpList);

            var complete = results.every(function (ok) {
                return ok;
            });
            lastLoadFailed = !complete;
            if (complete) {
                lastSuccessfulLoad = Date.now();
            }
            // even a failed load refreshes the icons: the startup locked
            // icon would otherwise stick despite the vault being unlocked
            updateTabsIcon();
            broadcastCredentialState();
        });

        broadcastCredentialState();
        return loadInFlight;
    }

    _self.getCredentials = getCredentials;

    // Loads a single account and merges it in, leaving every other account's
    // credentials untouched. Adding an account needs only the new vault —
    // the ones already loaded have not changed.
    function loadAccountCredentials(account) {
        if (!master_password) {
            return Promise.resolve();
        }
        var cycle = credentialLoadCycle;
        var key = accountKey(account);
        var tmpList = [];
        return loadAccountInto(account, tmpList).then(function (ok) {
            // a full reload started meanwhile and already covers this
            // account — its results win
            if (cycle !== credentialLoadCycle || !master_password) {
                return;
            }
            if (!ok) {
                lastLoadFailed = true;
                broadcastCredentialState();
                return;
            }
            local_credentials = local_credentials.filter(function (credential) {
                return accountKey(credential.account) !== key;
            }).concat(tmpList);
            // With a single configured account this WAS a complete load, so
            // it can stand in for one — that keeps a fresh setup from
            // looking permanently stale. With several accounts the periodic
            // refresh is left to establish that.
            if (_self.settings.accounts && _self.settings.accounts.length === 1) {
                lastLoadFailed = false;
                lastSuccessfulLoad = Date.now();
            }
            updateTabsIcon();
            broadcastCredentialState();
        });
    }

    // Applies an account-list change without a blanket refetch: added
    // accounts load their own vault, removed accounts simply have their
    // credentials dropped from memory, and a settings save that left the
    // account list alone touches the server not at all.
    function reconcileAccounts(before, after) {
        if (!master_password) {
            return Promise.resolve();
        }
        var beforeKeys = before.map(accountKey);
        var afterKeys = after.map(accountKey);

        var removed = beforeKeys.filter(function (key) {
            return afterKeys.indexOf(key) === -1;
        });
        if (removed.length > 0) {
            local_credentials = local_credentials.filter(function (credential) {
                return removed.indexOf(accountKey(credential.account)) === -1;
            });
            updateTabsIcon();
            broadcastCredentialState();
        }

        var added = after.filter(function (account) {
            return beforeKeys.indexOf(accountKey(account)) === -1;
        });
        if (added.length === 0) {
            return Promise.resolve();
        }
        return Promise.all(added.map(function (account) {
            return loadAccountCredentials(account);
        }));
    }

    function getCredentialsByUrl(_url, sender) {
        if (!master_password) {
            return [];
        }
        if (!_url || _url === '') {
            return [];
        }
        if (Array.isArray(_url)) {
            _url = _url.pop();
        }

        var p = document.createElement('a');
        p.href = _url;
        if (p.pathname) {
            //_url = _url.substring(0, _url.lastIndexOf("/"));
        }

        var url = processURL(_url, _self.settings.ignoreProtocol, _self.settings.ignoreSubdomain, _self.settings.ignorePath, _self.settings.ignorePort);
        var found_list = [];
        for (var i = 0; i < local_credentials.length; i++) {
            // a credential may carry several newline-separated URLs —
            // split BEFORE normalizing: the URL parser strips newlines,
            // so processing the whole string folded every later entry
            // into the first one's host or path and matched nothing
            var stored_urls = String(local_credentials[i].url || '').split('\n');
            for (var j = 0; j < stored_urls.length; j++) {
                var credential_url = stored_urls[j].trim();
                if (credential_url === '') {
                    continue;
                }
                if (!/^(ht)tps?:\/\//i.test(credential_url)) {
                    // a scheme-less stored URL is assumed to be https:
                    // borrowing the page's scheme would let a plain-http
                    // page satisfy the credential with protocol matching on
                    credential_url = 'https://' + credential_url;
                }
                credential_url = processURL(credential_url, _self.settings.ignoreProtocol, _self.settings.ignoreSubdomain, _self.settings.ignorePath, _self.settings.ignorePort);
                if (credential_url && credential_url === url) {
                    found_list.push(local_credentials[i]);
                    break;
                }
            }

        }
        return found_list;
    }

    _self.getCredentialsByUrl = getCredentialsByUrl;


    function saveCredential(credential) {
        //@TODO save shared password
        // a record whose fields failed authenticated decryption had them
        // emptied defensively — re-saving would overwrite the stored data
        // with blanks. Only deletion is allowed through; repair is
        // delete-and-recreate.
        if (credential.__decryptError && !(credential.delete_time > 0)) {
            return Promise.reject(new Error('Refusing to overwrite a damaged credential'));
        }
        if (!credential.credential_id) {
            return new Promise(function (resolve, reject) {
                PAPI.createCredential(credential.account, credential, credential.account.vault_password, function (createdCredential) {
                    if (!createdCredential) {
                        reject(new Error('Credential creation failed'));
                        return;
                    }
                    local_credentials.push(createdCredential);
                    updateTabsIcon();
                    broadcastCredentialState();
                    resolve();
                });
            });
        }
        var credential_index;
        for (var i = 0; i < local_credentials.length; i++) {
            if (local_credentials[i].guid === credential.guid) {
                credential_index = i;
                break;
            }
        }

        if (credential.hasOwnProperty('acl')) {
            var permissons = new SharingACL(credential.acl.permissions.permission);
            if (!permissons.hasPermission(0x02)) {
                return Promise.reject(new Error('No write permission on this credential'));
            }
        }

        return new Promise(function (resolve, reject) {
            PAPI.updateCredential(credential.account, credential, credential.account.vault_password, function (updatedCredential) {
                if (!updatedCredential) {
                    reject(new Error('Credential update failed'));
                    return;
                }
                if (credential_index !== undefined) {
                    if (credential.delete_time > 0) {
                        // Deleted server-side, so drop it here too. This is
                        // what used to force a full re-download of every
                        // vault just to notice one record had gone.
                        local_credentials.splice(credential_index, 1);
                    } else {
                        local_credentials[credential_index] = updatedCredential;
                    }
                }
                updateTabsIcon();
                broadcastCredentialState();
                resolve();
            });
        });
    }

    _self.saveCredential = saveCredential;

    function getCredentialByGuid(guid) {
        for (var i = 0; i < local_credentials.length; i++) {
            var credential = local_credentials[i];
            if (credential.guid === guid) {
                return credential;
            }
        }
    }

    _self.getCredentialByGuid = getCredentialByGuid;

    // The in-page picker can open the browser-action popup only from the
    // edit button's user gesture. Keep the requested route in the persistent
    // background page so the newly created popup can consume it before
    // Angular starts, without writing a credential identifier to storage.
    var queuedCredentialEditGuid = null;

    function queueCredentialEdit(guid) {
        if (guid === null || guid === undefined || guid === '' ||
                !getCredentialByGuid(guid)) {
            return false;
        }
        queuedCredentialEditGuid = guid;
        return true;
    }

    function consumeCredentialEdit() {
        var guid = queuedCredentialEditGuid;
        queuedCredentialEditGuid = null;
        return guid;
    }

    function cancelCredentialEdit(guid) {
        if (queuedCredentialEditGuid === guid) {
            queuedCredentialEditGuid = null;
        }
    }

    function openCredentialEditor(guid) {
        if (!queueCredentialEdit(guid) ||
                !API.api.browserAction ||
                typeof API.api.browserAction.openPopup !== 'function') {
            return Promise.resolve(false);
        }
        return API.api.browserAction.openPopup().then(function () {
            return true;
        }).catch(function () {
            cancelCredentialEdit(guid);
            return false;
        });
    }

    _self.consumeCredentialEdit = consumeCredentialEdit;
    _self.openCredentialEditor = openCredentialEditor;

    function getCredentialForHTTPAuth(req) {
        return getCredentialsByUrl(req.url)[0];
    }

    _window.getCredentialForHTTPAuth = getCredentialForHTTPAuth;

    var mined_data = [];

    function minedForm(data, sender) {
        var url = sender.url;
        var existingLogins = getCredentialsByUrl(sender.url);
        var title = API.i18n.getMessage('detected_new_login') + ':';
        var minedMatchingID = null;
        for (var j = 0; j < existingLogins.length; j++) {
            var login = existingLogins[j];
            if (login.username === data.username) {
                if (login.password !== data.password) {
                    minedMatchingID = login.guid;
                    title = API.i18n.getMessage('detected_changed_login') + ':';
                }
                else {
                    //console.log('No changes detected');
                    delete mined_data[sender.tab.id];
                    return;
                }
            }
        }
        mined_data[sender.tab.id] = {
            title: title,
            url: url,
            username: data.username,
            password: data.password,
            label: sender.title,
            guid: minedMatchingID
        };

        //console.log('Done mining, ', mined_data, sender.tab.id);
    }

    _self.minedForm = minedForm;

    function getMinedData(args, sender) {
        var senderUrl = sender.tab.url;
        var site = processURL(senderUrl, _self.settings.ignoreProtocol, _self.settings.ignoreSubdomain, _self.settings.ignorePath, _self.settings.ignorePort);
        if (!_self.settings) {
            return null;
        }
        var mined = mined_data[sender.tab.id];
        if (!mined) {
            return mined;
        }
        // the tab may have navigated elsewhere since the login was
        // submitted — only offer the save prompt while it is still on the
        // mined site (the entry is kept, so navigating back re-offers it)
        var minedSite = processURL(mined.url, _self.settings.ignoreProtocol, _self.settings.ignoreSubdomain, _self.settings.ignorePath, _self.settings.ignorePort);
        if (minedSite !== site) {
            return null;
        }
        if (!_self.settings.hasOwnProperty('ignored_sites')) {
            return mined;
        }
        var matches = _self.settings.ignored_sites.filter(function (item) {
            // an empty entry must never match every site (parity with findUrl)
            return typeof item === 'string' && item !== '' && site.indexOf(item) > -1;
        });

        if (matches.length !== 0) {
            return null;
        }
        return mined;
    }

    _self.getMinedData = getMinedData;

    function clearMined(args, sender) {
        // ignoreSite calls this without a sender — guard so it can't throw
        if (sender && sender.tab) {
            delete mined_data[sender.tab.id];
        }
    }

    _self.clearMined = clearMined;

    // tabs without a live content script (about:, the add-ons site, or a
    // tab that closed mid-flight) reject sendMessage — expected there,
    // and not worth an unhandled rejection in the console
    function ignoreSendError() {}

    function saveMinedCallback(args) {
        createIconForTab(args.sender.tab);
        var tabId = args.sender.tab.id;
        if (args.selfAdded) {
            // credential added from the in-page picker: the top frame
            // renders the confirmation doorhanger (and refills top-level
            // forms)...
            API.tabs.sendMessage(tabId, {method: "minedLoginSaved", args: args}, {frameId: 0}).catch(ignoreSendError);
            // ...and the frame that owns the picker refills its own form,
            // routed by the picker's frame token so no other frame ever
            // receives — let alone enters — the plaintext credential
            if (args.frameToken) {
                API.tabs.sendMessage(tabId, {method: "minedLoginSaved", args: args, frameToken: args.frameToken}).catch(ignoreSendError);
            }
            return;
        }
        // the open doorhanger only needs the outcome to update its label
        // and close itself — broadcast a scrubbed payload so the saved
        // credential never leaves the background page at all
        API.tabs.sendMessage(tabId, {
            method: "minedLoginSaved",
            args: {updated: !!args.updated}
        }).catch(ignoreSendError);
    }

    function ignoreSite(_url, sender) {
        if (!_self.settings.hasOwnProperty('ignored_sites')) {
            _self.settings.ignored_sites = [];
        }
        var site = processURL(_url, false, false, true, false);
        var persisted = Promise.resolve();
        if (_self.settings.ignored_sites.indexOf(site) === -1) {
            _self.settings.ignored_sites.push(site);
            persisted = saveSettings(_self.settings);
        }
        // pass the sender through so the mined data for the right tab is
        // cleared (and clearMined no longer throws on a missing sender)
        clearMined(null, sender);
        return persisted;
    }

    _self.ignoreSite = ignoreSite;

    function ignoreURL(url) {
        if (!_self.settings.hasOwnProperty('ignored_sites')) {
            _self.settings.ignored_sites = [];
        }
        if (_self.settings.ignored_sites.indexOf(url) === -1) {
            _self.settings.ignored_sites.push(url);
            return saveSettings(_self.settings);
        }
        return Promise.resolve();
    }

    _self.ignoreURL = ignoreURL;

    function passToParent(args, sender) {
        API.tabs.sendMessage(sender.tab.id, {
            method: args.injectMethod,
            args: args.args,
            frameToken: args.frameToken
        }).catch(ignoreSendError);
    }

    _self.passToParent = passToParent;

    function getActiveTab(opt) {
        API.tabs.query({active: true, currentWindow: true}).then(function (tabs) {
            var tab = tabs[0];
            if (!tab) {
                return;
            }
            return API.tabs.sendMessage(tab.id, {method: opt.returnFn, args: tab});
        }).catch(ignoreSendError);
    }

    _self.getActiveTab = getActiveTab;

    function themeChanged(pref) {
        // relay the popup's theme switch into every tab: extension frames
        // embedded in content pages (picker / doorhanger / auto-login)
        // receive tabs.sendMessage like any frame in the tab, but the
        // popup's runtime broadcast never reaches them — without this hop
        // an open picker keeps its old theme until reopened. Receivers in
        // theme.js never re-broadcast, so this cannot loop.
        API.tabs.query({}).then(function (tabs) {
            for (var i = 0; i < tabs.length; i++) {
                API.tabs.sendMessage(tabs[i].id, {method: 'themeChanged', args: pref}).catch(ignoreSendError);
            }
        });
    }

    _self.themeChanged = themeChanged;

    function updateCredentialUrlDoorhanger(login) {
        if(!_self.settings.enableUpdateUrl){
            return;
        }

        API.tabs.query({active: true, currentWindow: true}).then(function (tabs) {
            var tab = tabs[0];
            if (!tab) {
                return;
            }
            // only offer the update when the tab's URL is genuinely new for
            // this credential: if it already matches the tab under the same
            // rules getCredentialsByUrl serves the picker and autofill with,
            // there is nothing to update and the doorhanger would pop up
            // after every fill on the credential's own site
            var matching = getCredentialsByUrl(tab.url);
            for (var i = 0; i < matching.length; i++) {
                if (login.guid && matching[i].guid === login.guid) {
                    return;
                }
            }
            var data = login;
            data.url = tab.url;
            data.title = API.i18n.getMessage('detected_changed_url') + ':';
            // doorhangers render in the top frame only — deliver there
            // directly instead of broadcasting the credential tab-wide
            return API.tabs.sendMessage(tab.id, {
                method: 'showUrlUpdateDoorhanger',
                args: {data: data}
            }, {frameId: 0});
        }).catch(ignoreSendError);
    }

    _self.updateCredentialUrlDoorhanger = updateCredentialUrlDoorhanger;

    function updateCredentialUrl(data, sender) {
        mined_data[sender.tab.id] = data;
        return saveMined({}, sender);

    }

    _self.updateCredentialUrl = updateCredentialUrl;

    function saveMined(args, sender) {
        var data = mined_data[sender.tab.id];
        var credential = {},
            credential_index;

        if (data.guid === null) {
            credential = PAPI.newCredential();
        } else {
            for (var i = 0; i < local_credentials.length; i++) {
                if (local_credentials[i].guid === data.guid) {
                    credential = local_credentials[i];
                    credential_index = i;
                    break;
                }
            }
        }
        if (!credential.hasOwnProperty('account')) {
            credential.account = args.account;
        }
        credential.username = data.username;
        credential.password = data.password;
        credential.url = sender.tab.url;
        if (credential.guid !== null) {
            return new Promise(function (resolve, reject) {
                PAPI.updateCredential(credential.account, credential, credential.account.vault_password, function (updatedCredential) {
                    if (!updatedCredential) {
                        reject(new Error('Credential update failed'));
                        return;
                    }
                    updatedCredential.account = credential.account;
                    if (credential_index !== undefined) {
                        local_credentials[credential_index] = updatedCredential;
                    }
                    saveMinedCallback({credential: credential, updated: true, sender: sender});
                    delete mined_data[sender.tab.id];
                    resolve();
                });
            });
        }
        credential.label = sender.tab.title;
        credential.vault_id = credential.account.vault.vault_id;
        return new Promise(function (resolve, reject) {
            PAPI.createCredential(credential.account, credential, credential.account.vault_password, function (createdCredential) {
                if (!createdCredential) {
                    reject(new Error('Credential creation failed'));
                    return;
                }
                createdCredential.account = args.account;
                saveMinedCallback({credential: credential, updated: false, sender: sender});
                local_credentials.push(createdCredential);
                delete mined_data[sender.tab.id];
                resolve();
            });
        });
    }

    _self.saveMined = saveMined;

    function searchCredential(searchText) {
        // an empty (or non-string) query would match every credential via
        // indexOf('') — never serve the whole vault on a blank search
        if (!searchText || typeof searchText !== 'string') {
            return [];
        }
        searchText = searchText.toLowerCase();
        var searchFields = ['label', 'username', 'email', 'url', 'description'];
        var results = [];
        for (var i = 0; i < local_credentials.length; i++) {
            var credential = local_credentials[i];
            for (var f = 0; f < searchFields.length; f++) {
                var field = searchFields[f];
                if (!credential[field]) {
                    continue;
                }

                var field_value = credential[field].toLowerCase();
                if (field_value.indexOf(searchText) !== -1) {
                    results.push(credential);
                    break;
                }
            }
        }
        return results;
    }

    _self.searchCredential = searchCredential;


    function injectCreateCredential(args, sender) {
        var account = getRuntimeSettings().accounts[parseInt(args.vaultIndex)];
        var credential = PAPI.newCredential();
        credential.label = args.label;
        credential.username = args.username;
        credential.password = args.password;
        credential.url = sender.tab.url;
        credential.vault_id = account.vault.vault_id;
        return new Promise(function (resolve, reject) {
            PAPI.createCredential(account, credential, account.vault_password, function (createdCredential) {
                if (!createdCredential) {
                    reject(new Error('Credential creation failed'));
                    return;
                }
                credential.account = account;
                saveMinedCallback({credential: credential, updated: false, sender: sender, selfAdded: true, frameToken: args.frameToken});
                local_credentials.push(createdCredential);
                resolve();
            });
        });
    }

    self.injectCreateCredential = injectCreateCredential;

    function isAutoFillEnabled() {
        if (!_self.settings.hasOwnProperty('enableAutoFill')) {
            return true;
        }
        return _self.settings.enableAutoFill;
    }

    _self.isAutoFillEnabled = isAutoFillEnabled;

    function isAutoSubmitEnabled() {
        if (!_self.settings.hasOwnProperty('enableAutoSubmit')) {
            return false;
        }
        return _self.settings.enableAutoSubmit;
    }

    _self.isAutoSubmitEnabled = isAutoSubmitEnabled;

    // doorhanger payloads are per-tab: two tabs showing doorhangers must
    // never read each other's data (the mined flow carries the plaintext
    // password), and an entry is dropped as soon as its doorhanger read
    // it so stale secrets don't linger
    var doorhangerData = {};

    function setDoorhangerData(data, sender) {
        if (!sender.tab) {
            return;
        }
        doorhangerData[sender.tab.id] = data;
    }

    _self.setDoorhangerData = setDoorhangerData;

    function getDoorhangerData(args, sender) {
        if (!sender.tab) {
            return null;
        }
        var data = doorhangerData[sender.tab.id];
        delete doorhangerData[sender.tab.id];
        return data || null;
    }

    _self.getDoorhangerData = getDoorhangerData;

    function closeSetupTab() {
        // resolve through the runtime so the scheme is right on both
        // Firefox (moz-extension:) and Chromium (chrome-extension:).
        // The background page does not load API/extension.js, so this must
        // use API.runtime.getURL — API.extension would be undefined here.
        API.tabs.query({url: API.runtime.getURL('/html/browser_action/browser_action.html')}).then(function (tabs) {
            if (tabs && tabs[0]) {
                API.tabs.remove(tabs[0].id);
            }
        });
    }

    _self.closeSetupTab = closeSetupTab;

    // Explicit allowlist of the methods that may be invoked over runtime
    // messages. This IIFE runs sloppy-mode, so _self resolves to the
    // background window (background.js:5) — without this allowlist the
    // dispatcher would reach ANY own function property of that window: every
    // global declared by any background script (processURL, PAPI, $, …) and
    // built-ins such as eval. Keep this list in sync when adding a public
    // message handler.
    var messageHandlers = {
        clearMined: true, closeSetupTab: true, consumeCredentialEdit: true,
        getActiveTab: true,
        getCredentialByGuid: true, getCredentials: true, getCredentialsByUrl: true,
        getDoorhangerData: true, getMasterPasswordSet: true, getMinedData: true,
        getRuntimeSettings: true, getSetting: true, getSettings: true,
        ignoreSite: true, ignoreURL: true, injectCreateCredential: true,
        isAutoFillEnabled: true, isAutoSubmitEnabled: true, isMasterPasswordValid: true,
        minedForm: true, openCredentialEditor: true, passToParent: true,
        resetSettings: true,
        saveCredential: true, saveMined: true, saveSettings: true,
        searchCredential: true,
        setDoorhangerData: true, setMasterPassword: true, themeChanged: true,
        updateCredentialUrl: true, updateCredentialUrlDoorhanger: true
    };

    API.runtime.onMessage.addListener(function (msg, sender, sendResponse) {

        if (!msg || !msg.hasOwnProperty('method')) {
            return;
        }
        // only accept messages from this extension's own contexts
        if (sender && sender.id && sender.id !== API.runtime.id) {
            return;
        }
        var result = false;
        if (Object.prototype.hasOwnProperty.call(messageHandlers, msg.method) &&
            typeof _self[msg.method] === 'function') {
            result = _self[msg.method](msg.args, sender);
        }

        // mutating handlers hand back a native promise for their async
        // work — return it so the sender settles with the REAL outcome
        // (resolving only once the write finished, rejecting on failure)
        // instead of an instant ack that masked every error. Sync handlers
        // keep the plain sendResponse path.
        if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
            return result;
        }
        sendResponse(result);
    });

    var defaultColor = '#0082c9';

    // The login count is drawn onto the toolbar icon rather than set through
    // the native badge API. A native badge hangs past the icon's top-right
    // corner (Firefox gives it negative margins) and picks its own text
    // colour — black on the Passman blue. Drawing it keeps the count inside
    // the icon box with the digits always white: the shield shrinks to 13/16
    // of the canvas toward the bottom-left, and the counter takes the freed
    // top-right corner, reproducing the overhang proportions of the real
    // badge. Tabs with no logins get the plain shield and no badge.

    var normalIconPaths = {
        '16': '/icons/icon16.png',
        '19': '/icons/icon19.png',
        '32': '/icons/icon32.png',
        '48': '/icons/icon48.png'
    };

    var ICON_CANVAS_SIZES = [16, 32, 64];
    var countIconCache = {};   // count -> {size: ImageData}
    var tabIconSeq = {};       // tabId -> newest icon request for that tab
    var baseIconPromise = null;

    function loadBaseIcon() {
        if (!baseIconPromise) {
            baseIconPromise = new Promise(function (resolve, reject) {
                var img = new Image();
                img.onload = function () { resolve(img); };
                img.onerror = function () { reject(new Error('toolbar icon failed to load')); };
                img.src = '/icons/icon64.png';
            });
        }
        return baseIconPromise;
    }

    // Downscale in halving steps — one big drawImage jump blurs the shield.
    function shrinkCanvas(source, targetW, targetH) {
        var cur = source;
        while (cur.width / 2 > targetW && cur.height / 2 > targetH) {
            var next = document.createElement('canvas');
            next.width = Math.round(cur.width / 2);
            next.height = Math.round(cur.height / 2);
            next.getContext('2d').drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, next.width, next.height);
            cur = next;
        }
        return cur;
    }

    // One icon size: the shield anchored bottom-left, the count in a rounded
    // box flush with the canvas' top-right corner — square for one digit,
    // widening with the count like the native badge's min-width plus
    // padding, and shrinking the font only when even the widest box (7/8 of
    // the canvas) cannot hold the digits.
    function composeCountIcon(master, count, size) {
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');

        var tile = Math.round(size * 0.8125);
        ctx.drawImage(shrinkCanvas(master, tile, tile), 0, size - tile, tile, tile);

        var text = String(count);
        var bh = Math.round(size * 0.5);
        var fontPx = Math.round(bh * 0.8);
        var pad = Math.round(bh * 0.25);
        var maxW = Math.round(size * 0.875);
        ctx.font = '600 ' + fontPx + 'px sans-serif';
        var textW = ctx.measureText(text).width;
        var bw = Math.min(Math.max(bh, Math.ceil(textW) + pad * 2), maxW);
        if (textW > bw - pad * 2) {
            fontPx = Math.max(5, Math.floor(fontPx * (bw - pad * 2) / textW));
            ctx.font = '600 ' + fontPx + 'px sans-serif';
        }
        var bx = size - bw;
        var radius = size * 0.125;

        ctx.beginPath();
        ctx.roundRect(bx, 0, bw, bh, radius);
        ctx.fillStyle = defaultColor;
        ctx.fill();
        // keyline so the badge keeps an edge against light toolbar themes
        ctx.strokeStyle = '#10131a';
        ctx.lineWidth = Math.max(1, size / 32);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + bw / 2, bh / 2 + size * 0.02);
        return ctx.getImageData(0, 0, size, size);
    }

    function buildCountIcon(count) {
        return loadBaseIcon().then(function (img) {
            var master = document.createElement('canvas');
            master.width = img.width;
            master.height = img.height;
            master.getContext('2d').drawImage(img, 0, 0);
            var set = {};
            ICON_CANVAS_SIZES.forEach(function (size) {
                set[size] = composeCountIcon(master, count, size);
            });
            countIconCache[count] = set;
            return set;
        });
    }

    function setCountIcon(tab, count) {
        if (!count) {
            API.browserAction.setIcon({
                path: normalIconPaths,
                tabId: tab.id
            });
            return;
        }
        var seq = (tabIconSeq[tab.id] || 0) + 1;
        tabIconSeq[tab.id] = seq;
        var ready = countIconCache[count]
            ? Promise.resolve(countIconCache[count])
            : buildCountIcon(count);
        ready.then(function (set) {
            // a newer request for this tab — or a lock meanwhile — wins
            if (tabIconSeq[tab.id] !== seq || !master_password) {
                return;
            }
            API.browserAction.setIcon({imageData: set, tabId: tab.id});
        }).catch(function () {
            // canvas or icon load unavailable — never leave a stale count
            if (tabIconSeq[tab.id] !== seq || !master_password) {
                return;
            }
            API.browserAction.setIcon({
                path: normalIconPaths,
                tabId: tab.id
            });
        });
    }

    function createIconForTab(tab) {
        if (!master_password) {
            return;
        }
        var tabUrl = tab.url;
        var logins = getCredentialsByUrl(tabUrl);
        if (tab.active) {
            window.contextMenu.setContextItems(logins);
        }
        var credentialAmount = logins.length;
        setCountIcon(tab, credentialAmount);

        var plural = (credentialAmount === 1) ? API.i18n.getMessage('credential') : API.i18n.getMessage('credentials');
        API.browserAction.setTitle({
            title: API.i18n.getMessage('browser_action_title_login', [credentialAmount.toString(), plural.toString()]),
            tabId: tab.id
        });
    }

    // While locked: no red badge — the toolbar icon itself swaps to a muted
    // shield with a small amber padlock, and any per-tab count badge is
    // cleared.
    var lockedIconPaths = {
        '16': '/icons/icon-locked-16.png',
        '19': '/icons/icon-locked-19.png',
        '32': '/icons/icon-locked-32.png',
        '48': '/icons/icon-locked-48.png'
    };

    function displayLogoutIcons() {
        if (_self.settings) {
            API.browserAction.setIcon({path: lockedIconPaths});
            API.browserAction.setBadgeText({text: ''});
            API.tabs.query({}).then(function (tabs) {
                for (var t = 0; t < tabs.length; t++) {
                    var tab = tabs[t];
                    API.browserAction.setIcon({
                        path: lockedIconPaths,
                        tabId: tab.id
                    });
                    API.browserAction.setBadgeText({
                        text: '',
                        tabId: tab.id
                    });
                    API.browserAction.setTitle({
                        title: API.i18n.getMessage('browser_action_title_locked'),
                        tabId: tab.id
                    });
                }
            });
        }
    }

    function updateTabsIcon() {
        // restore the normal icon globally (covers tabs opened later)
        API.browserAction.setIcon({
            path: normalIconPaths
        });
        API.tabs.query({}).then(function (tabs) {
            for (var t = 0; t < tabs.length; t++) {
                var tab = tabs[t];
                createIconForTab(tab);
            }
        });
    }


    API.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
        if (master_password) {
            createIconForTab(tab);
        } else {
            displayLogoutIcons();
        }
    });

    API.tabs.onActivated.addListener(function () {
        API.tabs.query({active: true, currentWindow: true}).then(function (tabs) {
            // the query can resolve empty while a window is closing
            if (!tabs || !tabs[0]) {
                return;
            }
            if (master_password) {
                createIconForTab(tabs[0]);
            } else {
                displayLogoutIcons();
            }
        });
    });

    // a closed tab can never show its doorhanger again — don't keep its
    // plaintext mined login (or pending doorhanger payload) for the rest
    // of the session
    API.tabs.onRemoved.addListener(function (tabId) {
        delete mined_data[tabId];
        delete doorhangerData[tabId];
        delete tabIconSeq[tabId];
    });

    displayLogoutIcons();


    MasterPasswordStore.load().then(function (password) {
        if (password) {
            master_password = password;
        }
        getSettings().then(function () {
            // Nothing is in memory yet at startup, so if the master password
            // was remembered this is a load that genuinely has to happen.
            if (master_password) {
                getCredentials();
            }
        });
    });
    return _window;
}());
