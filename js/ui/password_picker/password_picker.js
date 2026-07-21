$(document).ready(function () {
    var _this = this;
    var storage = new API.Storage();
    var runtimeSettings = {};
    // the picker's own document has no title — the add-credential label
    // defaults to the host page's title, delivered via returnActiveTab
    var pageTitle = '';

    // keyboard activation for role-annotated controls: Enter or Space on a
    // focused tab/button acts like a click (they are divs and spans, so the
    // browser gives them no keyboard semantics of their own)
    $(document).on('keydown', '[role="button"], [role="tab"]', function (e) {
        if (e.which === 13 || e.which === 32) {
            e.preventDefault();
            this.click();
        }
    });

    // keep Tab cycling inside the dialog while it is open: past the last
    // focusable wraps to the first, shift+Tab past the first wraps back
    $(document).on('keydown', function (e) {
        if (e.which !== 9) {
            return;
        }
        var focusable = $(document).find('button, input, select, textarea, a[href], [tabindex]').filter(function () {
            var ti = $(this).attr('tabindex');
            return (ti === undefined || parseInt(ti, 10) >= 0) && $(this).is(':visible') && !$(this).is(':disabled');
        });
        if (!focusable.length) {
            return;
        }
        var first = focusable.first()[0];
        var last = focusable.last()[0];
        var active = document.activeElement;
        if (e.shiftKey) {
            if (active === first || !$.contains(document.body, active)) {
                e.preventDefault();
                last.focus();
            }
        } else if (active === last) {
            e.preventDefault();
            first.focus();
        }
    });

    API.runtime.sendMessage(API.runtime.id, {'method': 'getRuntimeSettings'}).then(function (settings) {
        var accounts = settings.accounts;
        runtimeSettings = settings;
        for(var i = 0; i < accounts.length; i++) {
            // vault names come from the server — never concatenate them into markup
            $('#savepw-vault').append($('<option>').val(i).text(accounts[i].vault.name));
        }
        storage.get('activeTab').then(function (name) {
            if (name && name !== '') {
                // makeTabActive(name);
            }
        }).error(function () {
            // fresh install — no stored tab; nothing to restore
        });
        // load the current tab's credentials unconditionally: a missing
        // (fresh install) or poisoned activeTab key must not leave the
        // picker empty and the ignore buttons dead
        API.runtime.sendMessage(API.runtime.id, {method: "getActiveTab", args: {returnFn: "returnActiveTab"}});

    });

    $('[t]').each(function () {
        var string = $(this).attr('t');
        var startChar = string[0];
        var endChar = string[string.length - 1];
        var attribute;
        if (startChar === '[' && endChar === ']') {
            var data = string.replace('[', '').replace(']', '').split(',');
            attribute = data[1].trim();
            string = data[0].trim();
        }
        var translated = API.i18n.getMessage(string);
        if (attribute) {
            $(this).attr(attribute, translated);
        } else {
            $(this).text(translated);
        }
    });

    function fillLogin(login) {
        API.runtime.sendMessage(API.runtime.id, {
            method: 'passToParent',
            args: {
                injectMethod: 'enterLoginDetails',
                args: login,
                // ties this fill to the frame that opened this picker (its
                // token is in our URL hash) — the background relays it and
                // only that frame enters the credential
                frameToken: window.location.hash.slice(1)
            }
        }).then(function () {
            removePasswordPicker();
        });
    }

    function removePasswordPicker(login) {
        API.runtime.sendMessage(API.runtime.id, {
            method: 'passToParent',
            args: {
                injectMethod: 'removePasswordPicker'
            }
        });
    }

    function copyTextToClipboard(text) {
        var copyFrom = document.createElement("textarea");
        copyFrom.textContent = text;
        var body = document.getElementsByTagName('body')[0];
        body.appendChild(copyFrom);
        copyFrom.select();
        document.execCommand('copy');
        body.removeChild(copyFrom);
    }

    _this.copyTextToClipboard = copyTextToClipboard;


    function setupAddCredentialFields() {
        var labelfield = $('#savepw-label');
        labelfield.val(pageTitle);
        var userfield = $('#savepw-username');
        var pwfield = $('#savepw-password');
        var vaultfield = $('#savepw-vault');
        $('.togglePw').click(function () {
            $('.togglePw').find('.fa').toggleClass('fa-eye').toggleClass('fa-eye-slash');
            if (pwfield.attr('type') === 'password') {
                pwfield.attr('type', 'text');
            } else {
                pwfield.attr('type', 'password');
            }
        });

        $('#savepw-save').click(function (e) {
            var fields = [labelfield, pwfield];
            var hasErrors = false;
            $.each(fields, function (k, field) {
               field.removeClass('error');
                if(!$(field).val()){
                   field.addClass('error');
                   hasErrors = true;
                }
            });
            e.preventDefault();
            if(hasErrors){
                return;
            }
            $(this).text(API.i18n.getMessage("saving"));
            $(this).attr('disabled', true);
            API.runtime.sendMessage(API.runtime.id, {
                method: "injectCreateCredential",
                args: {
                    label: labelfield.val(),
                    username: userfield.val(),
                    password: pwfield.val(),
                    vaultIndex: vaultfield.val(),
                    // same routing token as fillLogin: the post-save
                    // refill must land in the frame owning this picker
                    frameToken: window.location.hash.slice(1)
                }
            }).then(removePasswordPicker).catch(function () {
                // the server rejected the new credential — keep the picker
                // open with everything entered and re-arm the save button
                // instead of closing and losing it
                var btn = $('#savepw-save');
                btn.text(API.i18n.getMessage('save'));
                btn.attr('disabled', false);
            });
        });

        $('#savepw-cancel').click(function () {
            labelfield.val(pageTitle);
            userfield.val('');
            pwfield.val('');
            removePasswordPicker();
        });

    }

    function toggleFieldType(field) {
        if ($(field).attr('type').toLowerCase() === 'text') {
            $(field).attr('type', 'password');
        } else {
            $(field).attr('type', 'text');
        }
    }

    function genPwd(settings) {
        /* jshint ignore:start */
        var password = generatePassword(settings['length'],
            settings.useUppercase,
            settings.useLowercase,
            settings.useDigits,
            settings.useSpecialChars,
            settings.minimumDigitCount,
            settings.avoidAmbiguousCharacters,
            settings.requireEveryCharType);
        /* jshint ignore:end */
        return password;
    }

    function getPasswordGenerationSettings(cb) {
        var default_settings = {
            'length': 12,
            'useUppercase': true,
            'useLowercase': true,
            'useDigits': true,
            'useSpecialChars': true,
            'minimumDigitCount': 3,
            'avoidAmbiguousCharacters': false,
            'requireEveryCharType': true
        };
        storage.get('password_generator_settings').then(function (_settings) {
            if (!_settings) {
                _settings = default_settings;
            }

            cb(_settings);
        }).error(function () {
            cb(default_settings);
        });
    }

    function setupPasswordGenerator() {
        //getPasswordGeneratorSettings
        getPasswordGenerationSettings(function (settings) {
            var round = 0;

            function generate_pass(inputId) {
                var new_password = genPwd(settings);
                $('#' + inputId).val(new_password);
                setTimeout(function () {
                    if (round < 10) {
                        generate_pass(inputId);
                        round++;
                    } else {
                        round = 0;
                    }
                }, 10);
            }

            $.each(settings, function (setting, val) {
                if (typeof(val) === "boolean") {
                    $('[name="' + setting + '"]').prop('checked', val);
                } else {
                    $('[name="' + setting + '"]').val(val);
                }
            });

            $('form[name="advancedSettings"]').change(function () {
                var pw_settings_form = $(this);
                settings = pw_settings_form.serializeObject();
                storage.set('password_generator_settings', settings);
            });

            $('.renewpw').click(function () {
                generate_pass('generated_password');
            });
            $('.renewpw_newac').click(function () {
                generate_pass('savepw-password');

            });
            $('.renewpw').click();
            $('.renewpw_newac').click();

            $('.usepwd').click(function () {
                $('#savepw-password').val($('#generated_password').val());
                $('.tab.add').click();
            });

            $('.togglePwVis').click(function () {
                toggleFieldType('#generated_password');
                $(this).find('.fa').toggleClass('fa-eye-slash').toggleClass('fa-eye');
            });

            $('.adv_opt').click(function () {

                var adv_settings = $('.pw-setting-advanced');
                $(this).find('i').toggleClass('fa-angle-right').toggleClass('fa-angle-down');
                if (adv_settings.is(':visible')) {
                    adv_settings.slideUp();
                } else {
                    adv_settings.slideDown();
                }
            });
        });
    }

    var picker = $('#password_picker');
    var makeTabActive = function (name) {
        picker.find('.tab').removeClass('active').attr('aria-selected', 'false');
        picker.find('.tab-content').children().hide();
        picker.find('.tab-' + name + '-content').show();
        var activeTab = picker.find('.tab.' + name).addClass('active').attr('aria-selected', 'true');
        // keep focus on the newly active tab — unless it already lives
        // inside the tab's content (e.g. the search input focuses itself)
        var ae = document.activeElement;
        if (ae === document.body || picker.find('.tab').is(ae)) {
            activeTab.focus();
        }
    };

    // re-clicking the active search tab must not blur the search input —
    // swallow the mousedown so the browser never moves focus away
    picker.find('.tab.search').on('mousedown', function (e) {
        e.preventDefault();
    });

    picker.find('.tab').click(function () {
        var name = $(this).attr('data-name');
        // the close button carries the .tab class but no data-name — let its
        // own handler close the picker instead of poisoning activeTab
        if (!name) {
            return;
        }
        if (name === 'search') {
            $('#password_search').focus();
        }
        storage.set('activeTab', name).then(function (r) {
            makeTabActive(name);
            if(name === 'search'){
                $('#password_search').focus();
            }
        });
    });
    


    $('.tab.close').click(function () {
        removePasswordPicker();
    });


    function disablePassman(where, url){
        var whereFn = (where === 'site') ? 'Site' : 'URL';
        API.runtime.sendMessage(API.runtime.id, {
            method: "ignore"+ whereFn,
            args: url
        }).then(function () {
            var text = (where === 'site') ? 'site_ignored' : 'url_ignored';
            $('.tab-ignore-content').find('.text').text(API.i18n.getMessage(text));
            setTimeout(function () {
                removePasswordPicker();
            }, 2500);
        });
    }



    function returnActiveTab(tab) {
        // default the add-credential label to the host page's title —
        // without clobbering anything the user already typed
        pageTitle = tab.title || '';
        var labelfield = $('#savepw-label');
        if (!labelfield.val()) {
            labelfield.val(pageTitle);
        }

        $('.disable-site').on('click', function () {
            disablePassman('site', tab.url);
        });

        $('.disable-page').on('click', function () {
            disablePassman('url', tab.url);
        });

        API.runtime.sendMessage(API.runtime.id, {
            method: "getCredentialsByUrl",
            args: [tab.url]
        }).then(function (logins) {
            if (logins.length === 0) {
                API.runtime.sendMessage(API.runtime.id, {
                    'method': 'getSetting',
                    args: 'no_results_found_tab'
                }).then(function (value) {
                    makeTabActive(value);
                });
                return;
            }
            if (logins.length !== 0) {
                picker.find('.tab-list-content').html('');
                if(runtimeSettings.passwordPickerGotoList){
                    makeTabActive('list');
                }
            }
            for (var i = 0; i < logins.length; i++) {
                var login = logins[i];
                var div = $('<div>', {class: 'account', text: login.label, role: 'button', tabindex: '0'});
                $('<br>').appendTo(div);
                var username = (login.username !== '' ) ? login.username : login.email;
                $('<small>').text(username).appendTo(div);
                /* jshint ignore:start */
                div.click((function (login) {
                    return function () {
                        //enterLoginDetails(login);
                        //API.runtime.sendMessage(API.runtime.id, {method: 'getMasterPasswordSet'})
                        fillLogin(login)
                    };
                })(login));
                /* jshint ignore:end*/

                picker.find('.tab-list-content').append(div);
            }
        });
    }

    _this.returnActiveTab = returnActiveTab;


    $('.no-credentials .save').on('click', function () {
        $('.tab.add').click();
    });
    $('.no-credentials .search').on('click', function () {
        $('.tab.search').click();
    });
    $('.no-credentials .gen').on('click', function () {
        $('.tab.generate').click();
    });
    setupAddCredentialFields();
    setupPasswordGenerator();

    // move keyboard focus into the dialog on open — keyboard and screen
    // reader users land on the active tab, mouse flows are unaffected
    picker.find('.tab.active').focus();


    API.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (_this[msg.method]) {
            _this[msg.method](msg.args, sender);
        }
    });


    $('#password_search').keyup(function () {
        searchCredentials();
    });

    function url_domain(data) {
        if(!data){
            return '';
        }
        var matches = data.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i);
        return matches && matches[1];  // domain will be null if no match is found
    }


    function searchCredentials() {

        var searchText = $('#password_search').val();
        if (searchText === '') {
            return;
        }
        API.runtime.sendMessage(API.runtime.id, {
            'method': 'searchCredential',
            args: searchText
        }).then(function (result) {
            // append the jQuery nodes directly — serializing them to an HTML
            // string (as this used to do) strips the click handlers
            var searchResults = picker.find('#searchResults');
            searchResults.empty();
            if (!result || result.length === 0) {
                searchResults.text(API.i18n.getMessage('no_credentials_found'));
                return;
            }
            for (var i = 0; i < result.length; i++) {
                var login = result[i];
                var div = $('<div>', {class: 'account', text: login.label, role: 'button', tabindex: '0'});
                $('<br>').appendTo(div);

                var username = (login.username !== '' ) ? login.username : login.email;
                $('<small>').text(username).appendTo(div);
                $('<br>').appendTo(div);
                $('<small>').text(url_domain(login.url)).appendTo(div);
                /* jshint ignore:start */
                div.click((function (login) {
                    return function () {
                        fillLogin(login);
                        //@TODO Ask to update the url of the login
                        API.runtime.sendMessage(API.runtime.id, {
                            'method': 'updateCredentialUrlDoorhanger',
                            args: login
                        })
                    };
                })(login));
                /* jshint ignore:end*/
                searchResults.append(div);
            }
        });
    }

});
