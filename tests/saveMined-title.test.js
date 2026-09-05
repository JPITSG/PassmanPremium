'use strict';

// Exercise the real background handlers; only the browser and vault I/O are fake.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var writes = [];
var failNext = false;
var event = {addListener: function () {}};
var context = {
    Promise: Promise,
    API: {
        Storage: function () {},
        runtime: {onConnect: event, onMessage: event},
        browserAction: {setIcon: function () {}, setBadgeText: function () {}},
        tabs: {
            onUpdated: event, onActivated: event, onRemoved: event,
            query: function () { return Promise.resolve([]); },
            sendMessage: function () { return Promise.resolve(); }
        },
        i18n: {getMessage: function (key) { return key; }}
    },
    MasterPasswordStore: {load: function () { return new Promise(function () {}); }},
    $: {extend: Object.assign},
    processURL: function (url) { return new URL(url).origin; },
    PAPI: {
        newCredential: function () { return {guid: null}; },
        createCredential: function (account, credential, password, callback) {
            writes.push(Object.assign({}, credential));
            if (failNext) {
                failNext = false;
                callback(null);
            } else {
                callback(Object.assign({}, credential, {guid: 'created-' + writes.length}));
            }
        },
        updateCredential: function (account, credential, password, callback) {
            writes.push(Object.assign({}, credential));
            callback(Object.assign({}, credential));
        }
    }
};
context.self = context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/background/service/background.js'), 'utf8'), context);
context.settings = {ignored_sites: []};

var account = {vault: {name: 'Personal', vault_id: 1}};
var alternate = {vault: {name: 'Work', vault_id: 2}};
var sender = {url: 'https://example.test/login', tab: {id: 7, title: 'Sign in', url: 'https://example.test/login'}};
function mine() {
    context.minedForm({username: 'alice', password: 'fixture-password'}, sender);
}

(async function () {
    mine();
    sender.tab.title = 'Example dashboard';
    sender.tab.url = 'https://example.test/home';
    var preview = context.getMinedData({}, sender);
    assert.strictEqual(preview.label, 'Example dashboard', 'default follows the current page title');
    assert.strictEqual(writes.length, 0, 'preview does not save');
    var chosenTitle = 'Work <account> & "mail" — 私用';
    await context.saveMined({account: alternate, label: chosenTitle}, sender);
    assert.strictEqual(writes[0].label, chosenTitle);
    assert.strictEqual(writes[0].account, alternate);
    assert.strictEqual(writes[0].vault_id, 2);
    assert.strictEqual(writes[0].username, 'alice');
    assert.strictEqual(writes[0].password, 'fixture-password');
    assert.strictEqual(writes[0].url, sender.tab.url);
    assert.strictEqual(context.getMinedData({}, sender), undefined);

    mine();
    await context.saveMined({account: account}, sender);
    assert.strictEqual(writes[1].label, sender.tab.title, 'older callers keep the page-title default');

    mine();
    failNext = true;
    await assert.rejects(context.saveMined({account: account, label: 'Retry title'}, sender));
    assert.ok(context.getMinedData({}, sender), 'a failed save keeps the detected credential');
    await context.saveMined({account: account, label: 'Retry title'}, sender);
    assert.strictEqual(writes[3].label, 'Retry title');

    mine();
    context.clearMined({}, sender);
    await assert.rejects(context.saveMined({account: account, label: 'Cancelled'}, sender));
    assert.strictEqual(writes.length, 4, 'cancelled credentials are never written');

    // URL/password updates share saveMined but must keep the existing label.
    var existing = context.getCredentialByGuid('created-1');
    await context.updateCredentialUrl(Object.assign({}, existing, {password: 'updated-fixture-password'}), sender);
    assert.strictEqual(writes[4].label, chosenTitle);
    assert.strictEqual(writes[4].password, 'updated-fixture-password');
    console.log('saveMined title regression tests passed');
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
