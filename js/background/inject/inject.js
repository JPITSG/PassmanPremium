/* global API */
var $j = jQuery.noConflict();

$j(document).ready(function () {

    $j(document).click(function (event) {
        var passwordPickerRef = '.passwordPickerIframe';
        if (!$j(event.target).closest(passwordPickerRef).length) {
            if ($j(passwordPickerRef).is(":visible")) {
                removePasswordPicker();
            }
        }
    });

    var _this = this;
    Array.prototype.findUrl = function (match) {
        var matchParse = processURL(match, false, false, true, false);
        return this.filter(function (item) {
            // stored entries range from bare domains to full processed URLs;
            // the original one-way item.indexOf(matchParse) required the short
            // stored entry to CONTAIN the full page URL, so ignored sites
            // effectively never matched. Check containment both ways.
            return typeof item === 'string' && item !== '' &&
                (matchParse.indexOf(item) > -1 || item.indexOf(matchParse) > -1);
        });
    };

    function removePasswordPicker() {
        activeForm = undefined;
        $j('.passwordPickerIframe').remove();
    }

    _this.removePasswordPicker = removePasswordPicker;

    function enterLoginDetails(login, allowSubmit) {
        var username;

        if (login.hasOwnProperty('username')) {
            username = (login.username !== '' ) ? login.username : login.email;
        }
        if (!username) {
            username = null;
        }

        fillPassword(username, login.password);

        if (allowSubmit) {
            API.runtime.sendMessage(API.runtime.id, {method: 'isAutoSubmitEnabled'}).then(function (isEnabled) {
                if (isEnabled) {
                    submitLoginForm(username);
                }
            });
        }
    }

    _this.enterLoginDetails = enterLoginDetails;

    function enterCustomFields(login, settings) {
        var customFieldPattern = /^\#(.*)$/;

        /* do we have custom_fields for this entry */
        if (!login.hasOwnProperty('custom_fields') || !login.custom_fields.length) {
            return;
        }
        /* yes we do, iterate over all the custom_fields values */
        for (var i = 0, len = login.custom_fields.length; i < len; i++) {
            /* try / catch per field: one broken field must not abort the rest */
            try {
                var label = login.custom_fields[i].label;
                /* does this custom field label begin with a hash? */
                if (customFieldPattern.test(label)) {
                    /* set variable elementid to whatever element we are trying to auto fill */
                    var elementId = customFieldPattern.exec(label)[1];
                    enterCustomFieldElement(elementId, login.custom_fields[i].value);
                }
                else {
                    /* match the label text literally — interpolating the raw
                       label into a :contains() selector threw on ) or quotes */
                    var $label = $j('label[for]').filter(function () {
                        return $j(this).text().indexOf(label) !== -1;
                    }).first();
                    if ($label.length) {
                        enterCustomFieldElement($label.attr('for'), login.custom_fields[i].value);
                    }
                }
            }
            catch (e) {
                if (settings.debug) {
                    console.log('While attempting to auto fill custom fields the following exception was thrown: ' + e);
                }
            }
        }
    }

    function enterCustomFieldElement(elementId, value) {
        /* check to see if element id exist — getElementById, so ids with
           selector metacharacters can't break the lookup */
        var byId = document.getElementById(elementId);
        var element = false;
        if (byId) {
            element = $j(byId);
        }
        else { /* maybe element name exist (suffix match, as name$= did) */
            var byName = $j('input').filter(function () {
                var name = $j(this).attr('name');
                return typeof name === 'string' && name !== '' && name.slice(-elementId.length) === elementId;
            });
            if (byName.length) {
                element = byName;
            }
        }
        /* if we have an element and it is type text, number or password, lets auto fill it */
        if (element && (element[0].type === 'text' || element[0].type === 'number' || element[0].type === 'password')) {
            element.val(value);
        }
    }

    function submitLoginForm(username) {
        // activeForm is only set once the picker was used; on the automatic
        // autofill path fall back to the form of the first detected login
        // field, or the setting would never be able to fire there
        var form = activeForm;
        if (!form) {
            var loginFields = getLoginFields();
            if (loginFields.length > 0) {
                form = getFormFromElement(loginFields[0][1]);
            }
        }
        if (!form) {
            return;
        }

        var formEl = $j(form).closest('form');
        var iframeUrl = API.extension.getURL('/html/inject/auto_login.html');
        // the overlay carries the class loginPopupIframe (no id) — the old
        // id selector could never match and stacked overlays
        $j('.loginPopupIframe').remove();
        var loginPopup = $j('<iframe class="loginPopupIframe" scrolling="no" frameborder="0" src="' + iframeUrl + '"></iframe>');
        var padding = parseInt($j(formEl).css('padding').replace('px', ''));
        var margin = parseInt($j(formEl).css('margin').replace('px', ''));
        var height = Math.round($j(formEl).height() + (padding * 2) + (margin * 2));
        var width = Math.round($j(formEl).width() + (padding * 2) + (margin * 2));
        loginPopup.attr('height', height);
        loginPopup.attr('width', width);
        loginPopup.css('position', 'absolute');
        loginPopup.css('z-index', getMaxZ() + 1);
        loginPopup.css('background-color', 'rgba(0, 0, 0, 0.73)');
        loginPopup.css('left', Math.floor($j(formEl).offset().left - padding - margin));
        loginPopup.css('top', Math.floor($j(formEl).offset().top - padding - margin));
        removePasswordPicker();
        $j(document.body).prepend(loginPopup);
        // the overlay can only receive its username after it has loaded and
        // registered its listener — sending it right after prepend lost it
        loginPopup.on('load', function () {
            API.runtime.sendMessage(API.runtime.id, {'setIframeUsername': username}).then(function () {
                $j(formEl).trigger('submit');
                setTimeout(function () {
                    loginPopup.remove();
                }, 2000);
            });
        });
    }

    function getMaxZ() {
        // Math.max.apply throws RangeError on pages with very many
        // positioned elements (argument limit) and returns -Infinity when
        // there are none — compute the max in a loop instead
        var maxZ = 0;
        $j('body *').each(function () {
            if ($j(this).css('position') !== 'static') {
                var z = parseInt($j(this).css('z-index')) || 1;
                if (z > maxZ) {
                    maxZ = z;
                }
            }
        });
        return maxZ;
    }

    var activeForm;
    // token of this frame's open password picker: secret-bearing relays
    // from the background carry it and are acted on only by the frame
    // whose picker requested them — a credential chosen in one frame's
    // picker must never be entered into another frame's forms
    var activePickerToken;

    function showPasswordPicker(form) {
        var jPasswordPicker = $j('.passwordPickerIframe');
        if (jPasswordPicker.length > 1) {
            return;
        }
        var loginField = $j(form[0]);
        var loginFieldPos = loginField.offset();
        var loginFieldVisible = loginField.is(':visible');

        var position = $j(form[1]).position();
        var passwordField = $j(form[1]);
        var passwordFieldPos = passwordField.offset();
        var passwordFieldVisible = loginField.is(':visible');
        var left = (loginFieldPos) ? loginFieldPos.left : passwordFieldPos.left;
        var top = (loginFieldPos) ? loginFieldPos.top : passwordFieldPos.top;
        var maxZ = getMaxZ();

        if (loginFieldPos && passwordFieldPos.top > loginFieldPos.top) {
            //console.log('login fields below each other')
            top = passwordFieldPos.top + passwordField.height() + 10;
        } else {
            // console.log('login fields next to each other')
            if (loginFieldPos) {
                top = top + loginField.height() + 10;
            } else {
                top = top + passwordField.height() + 10;
            }
        }
        if (!loginFieldVisible) {
            left = passwordFieldPos.left;
        }

        // the iframe body keeps 8px of transparent padding around the card
        // as room for its shadow, so the frame must start 8px left of the
        // anchor field and run 16px wider than it for the visible card to
        // line up exactly with the field's edges (276 floor: below that the
        // tab bar no longer fits)
        var anchorField = (loginFieldPos && loginFieldVisible) ? loginField : passwordField;
        var frameWidth = Math.max(276, Math.round(anchorField.outerWidth()) + 16);

        activePickerToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
        var pickerUrl = API.extension.getURL('/html/inject/password_picker.html') + '#' + activePickerToken;

        var picker = $j('<iframe class="passwordPickerIframe" scrolling="no" height="385" frameborder="0" src="' + pickerUrl + '"></iframe>');
        picker.css('position', 'absolute');
        picker.css('width', frameWidth);
        picker.css('left', left - 8);
        picker.css('z-index', maxZ + 10);
        picker.css('top', top);
        $j('body').prepend($j(picker));
        activeForm = form;
        $j('.passwordPickerIframe:not(:last)').remove();
    }

    function onFormIconClick(e) {
        e.preventDefault();
        e.stopPropagation();
        var offsetX = e.offsetX;
        var offsetRight = (e.data.width - offsetX);
        if (offsetRight < e.data.height) {
            showPasswordPicker(e.data.form);
        }
    }

    // the picker icon is a background image on the field, so there is no
    // element to hover — hit-test the same right-side region the click
    // handler uses and swap in a pointer cursor while over the icon
    function onFormIconHover(e) {
        var overIcon = (e.data.width - e.offsetX) < e.data.height;
        $j(this).css('cursor', overIcon ? 'pointer' : '');
    }

    function createFormIcon(el, form) {
        var offset = el.offset();
        var width = el.width();
        var height = el.height() * 1;
        var margin = (el.css('margin')) ? parseInt(el.css('margin').replace('px', '')) : 0;
        var padding = (el.css('padding')) ? parseInt(el.css('padding').replace('px', '')) : 0;

        var pickerIcon = API.extension.getURL('/icons/icon.svg');
        $j(el).css('background-image', 'url("' + pickerIcon + '")');
        $j(el).css('background-repeat', 'no-repeat');
        //$j(el).css('background-position', '');
        $j(el).css('cssText', el.attr('style') + ' background-position: right 3px center !important; background-size: auto 75% !important;');

        $j(el).unbind('click', onFormIconClick);
        $j(el).click({width: width, height: height, form: form}, onFormIconClick);
        $j(el).unbind('mousemove', onFormIconHover);
        $j(el).mousemove({width: width, height: height}, onFormIconHover);
    }

    function createPasswordPicker(form) {
        for (var i = 0; i < form.length; i++) {
            var el = $j(form[i]);
            createFormIcon(el, form);
        }
    }

    function formSubmitted(fields) {
        var user = fields[0].value;
        var pass = fields[1].value;
        var params = {
            username: user,
            password: pass
        };
        //Disable password mining
        //$j(fields[1]).attr('type', 'hidden');
        API.runtime.sendMessage(API.runtime.id, {method: "minedForm", args: params});

    }

    function inIframe() {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    }

    function showDoorhanger(data) {
        if (inIframe()) {
            return;
        }
        data.data.currentLocation = window.location.href;
        API.runtime.sendMessage(API.runtime.id, {method: "setDoorhangerData", args: data});
        var pickerUrl = API.extension.getURL('/html/inject/doorhanger.html');

        var doorhanger = $j('<iframe id="password-toolbarIframe" style="display: none;" scrolling="no" height="60" width="100%" frameborder="0" src="' + pickerUrl + '"></iframe>');
        $j('#password-toolbarIframe').remove();
        doorhanger.css('z-index', getMaxZ() + 1);
        $j('body').prepend(doorhanger);
        $j('#password-toolbarIframe').fadeIn();
    }

    _this.showDoorhanger = showDoorhanger;

    function showUrlUpdateDoorhanger(data) {
        var buttons = ['cancel', 'updateUrl'];
        showDoorhanger({
            data: data.data,
            buttons: buttons
        });
    }

    _this.showUrlUpdateDoorhanger = showUrlUpdateDoorhanger;

    function checkForMined() {
        if (inIframe()) {
            return;
        }

        API.runtime.sendMessage(API.runtime.id, {method: "getMinedData"}).then(function (data) {
            if (!data) {
                return;
            }
            if (data.hasOwnProperty('username') && data.hasOwnProperty('password') && data.hasOwnProperty('url')) {
                var buttons = ['cancel', 'ignore', 'save'];
                showDoorhanger({data: data, buttons: buttons});
            }
        });
    }


    function closeDoorhanger() {
        $j('#password-toolbarIframe').hide(400);
        $j('#password-toolbarIframe').remove();
    }

    _this.closeDoorhanger = closeDoorhanger;

    var flagFilledForm = false;
    var initRanOnce = false;
    function initForms() {
        var loginFields = getLoginFields();
        // Mark newly appeared login fields: DOM mutations fire for every
        // unrelated node insertion on dynamic pages, so the full round
        // (settings + credential lookups, icons, bindings, fills) runs only
        // on the first pass and when the login fields themselves change.
        var fieldsChanged = false;
        for (var m = 0; m < loginFields.length; m++) {
            for (var f = 0; f < loginFields[m].length; f++) {
                var fieldEl = loginFields[m][f];
                if (fieldEl && !fieldEl.hasAttribute('data-passman-field')) {
                    fieldEl.setAttribute('data-passman-field', '1');
                    fieldsChanged = true;
                }
            }
        }
        if (initRanOnce && !fieldsChanged) {
            return;
        }
        initRanOnce = true;
        API.runtime.sendMessage(API.runtime.id, {method: 'getRuntimeSettings'}).then(function (settings) {
            var enablePasswordPicker = settings.enablePasswordPicker;
            var url = window.location.href;
            if (!settings.hasOwnProperty('ignored_sites') || settings.ignored_sites.findUrl(url).length !== 0) {
                return;
            }

            if (loginFields.length > 0) {
                for (var i = 0; i < loginFields.length; i++) {
                    var form = getFormFromElement(loginFields[i][0]);
                    if (enablePasswordPicker) {
                        createPasswordPicker(loginFields[i], form);
                    }

                    //Password miner — namespaced binding: re-runs replace the
                    //handler instead of stacking a duplicate on every pass
                    /* jshint ignore:start */
                    $j(form).off('submit.passman').on('submit.passman', (function (loginFields) {
                        return function () {
                            formSubmitted(loginFields);
                        };
                    })(loginFields[i]));
                    /* jshint ignore:end */
                }

                API.runtime.sendMessage(API.runtime.id, {
                    method: "getCredentialsByUrl",
                    args: url
                }).then(function (logins) {
                    if (logins.length === 1) {
                        API.runtime.sendMessage(API.runtime.id, {method: 'isAutoFillEnabled'}).then(function (isEnabled) {
                            if (isEnabled && !flagFilledForm) {
                                // automatic fill of a single match — the
                                // only path allowed to auto-submit (and
                                // only when the user enabled it)
                                enterLoginDetails(logins[0], true);
                                flagFilledForm = true;
                            }
                        });
                    }
                });
            }

            API.runtime.sendMessage(API.runtime.id, {
                method: "getCredentialsByUrl",
                args: url
            }).then(function (logins) {
                if (logins.length === 1) {
                    API.runtime.sendMessage(API.runtime.id, {method: 'isAutoFillEnabled'}).then(function (isEnabled) {
                        if (isEnabled) {
                            enterCustomFields(logins[0], settings);
                        }
                    });
                }
            });

        });
    }

    function minedLoginSaved(args) {
        // If the login added by the user then this is true
        if (args.selfAdded) {
            showDoorhanger({
                data: args,
                buttons: ['cancel']
            });
            enterLoginDetails(args.credential, false);
        }
    }

    _this.minedLoginSaved = minedLoginSaved;

    function resizeIframe(height) {
        $j('#password-toolbarIframe').height(60 + height);
    }

    _this.resizeIframe = resizeIframe;

    function copyText(text) {
        var txtToCopy = document.createElement('input');
        txtToCopy.style.left = '-300px';
        txtToCopy.style.position = 'absolute';
        txtToCopy.value = text;
        document.body.appendChild(txtToCopy);
        txtToCopy.select();
        document.execCommand('copy');
        txtToCopy.parentNode.removeChild(txtToCopy);
    }

    _this.copyText = copyText;

    function init() {
        checkForMined();
        initForms();
    }

    var readyStateCheckInterval = setInterval(function () {
        if (document.readyState === "complete") {
            clearInterval(readyStateCheckInterval);
            API.runtime.sendMessage(API.runtime.id, {method: 'getMasterPasswordSet'}).then(function (result) {
                if (result) {
                    init();
                    var body = document.getElementsByTagName('body')[0];
                    if (body) {
                        observeDOM(body, initForms);
                    }
                }
            });
        }
    }, 10);

    API.runtime.onMessage.addListener(function (msg, sender) {
        //console.log('Method call', msg.method);
        // relays meant for one frame's picker carry its token — Firefox
        // delivers tab messages to every frame, so without this check an
        // enterLoginDetails/minedLoginSaved relay would fill the plaintext
        // credential into every frame's forms, hostile iframes included
        if (msg.frameToken && msg.frameToken !== activePickerToken) {
            return;
        }
        if (_this[msg.method]) {
            _this[msg.method](msg.args, sender);
        }
    });
});
