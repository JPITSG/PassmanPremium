'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'lib', 'findForm.js'), 'utf8');
const context = {
    API: {
        runtime: {
            id: 'test-extension',
            sendMessage: function () {
                return {
                    then: function (callback) {
                        callback(false);
                        return this;
                    }
                };
            }
        }
    },
    console: console
};

vm.createContext(context);
vm.runInContext(source, context, {filename: 'findForm.js'});

function input(type, visible, value, attributes) {
    var attrs = attributes || {};
    return {
        type: type,
        value: value || '',
        _visible: visible,
        get offsetWidth() { return this._visible ? 200 : 0; },
        get offsetHeight() { return this._visible ? 30 : 0; },
        getClientRects: function () { return this._visible ? [{}] : []; },
        hasAttribute: function (name) {
            return Object.prototype.hasOwnProperty.call(attrs, name);
        },
        getAttribute: function (name) {
            return this.hasAttribute(name) ? attrs[name] : null;
        }
    };
}

function form(elements) {
    return {elements: elements, action: 'https://example.test/login'};
}

// Fields recognized while visible remain eligible when a site hides its form
// immediately before submission.
var username = input('text', true, 'alice', {autocomplete: 'username'});
var password = input('password', true, '', {autocomplete: 'current-password'});
var loginForm = form([username, password]);
var initial = context.formManager.getFormFields(loginForm, false);
assert.strictEqual(initial[0], username);
assert.strictEqual(initial[1], password);

password.value = 'correct horse battery staple';
username._visible = false;
password._visible = false;
username.type = 'hidden';
password.type = 'hidden';
var hiddenSubmission = context.formManager.getFormFields(loginForm, true);
assert.strictEqual(hiddenSubmission[0], username);
assert.strictEqual(hiddenSubmission[1], password);

// A form that was hidden from the outset must not become a credential form
// merely because a formdata event was observed.
var decoyUsername = input('text', false, 'decoy');
var decoyPassword = input('password', false, 'not-a-login');
var hiddenDecoy = context.formManager.getFormFields(form([decoyUsername, decoyPassword]), true);
assert.strictEqual(hiddenDecoy[0], null);
assert.strictEqual(hiddenDecoy[1], null);

// Submission-time new-password selection still considers every password box
// that was visible before the page hid the form.
var changeUser = input('email', true, 'alice@example.test');
var oldPassword = input('password', true, '');
var newPassword = input('password', true, '');
var confirmPassword = input('password', true, '');
var changeForm = form([changeUser, oldPassword, newPassword, confirmPassword]);
context.formManager.getFormFields(changeForm, false);
oldPassword.value = 'old-secret';
newPassword.value = 'new-secret';
confirmPassword.value = 'new-secret';
[changeUser, oldPassword, newPassword, confirmPassword].forEach(function (field) {
    field._visible = false;
});
var hiddenChange = context.formManager.getFormFields(changeForm, true);
assert.strictEqual(hiddenChange[0], changeUser);
assert.strictEqual(hiddenChange[1], confirmPassword);
assert.strictEqual(hiddenChange[2], oldPassword);

// Password-only forms remain outside credential mining because no username or
// email field resolves for the form.
var passwordOnly = input('password', true, 'secret');
var passwordOnlyFields = context.formManager.getFormFields(form([passwordOnly]), true);
assert.strictEqual(passwordOnlyFields[0], null);
assert.strictEqual(passwordOnlyFields[1], passwordOnly);

console.log('findForm submission regression tests passed');
