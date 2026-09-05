$(document).ready(function () {
    // keyboard activation for role-annotated controls: Enter or Space on a
    // focused button acts like a click (the vault selector is built from
    // spans and divs with no native keyboard semantics)
    $(document).on('keydown', '[role="button"]', function (e) {
        if (e.which === 13 || e.which === 32) {
            e.preventDefault();
            this.click();
        }
    });

    function closeDoorhanger() {
        $('#password-doorhanger').slideUp(function () {
            API.runtime.sendMessage(API.runtime.id, {
                method: "passToParent",
                args: {'injectMethod': 'closeDoorhanger'}
            });
        });
    }

    // The Cancel button doubles as the auto-dismiss timer: its label ticks
    // "Cancel (10)" .. "Cancel (1)" and at zero the doorhanger hides itself
    // (nothing is cleared — the prompt may reappear on a later visit).
    // Hovering the button stops the countdown and restores the plain label.
    function startCancelCountdown(btn) {
        var label = btn.find('.btn-text');
        var cancelText = API.i18n.getMessage('cancel');
        var remaining = 10;
        label.text(cancelText + ' (' + remaining + ')');
        function stopCountdown() {
            clearInterval(timer);
            label.text(cancelText);
        }
        var timer = setInterval(function () {
            remaining--;
            if (remaining <= 0) {
                clearInterval(timer);
                closeDoorhanger();
                return;
            }
            label.text(cancelText + ' (' + remaining + ')');
        }, 1000);
        btn.one('mouseenter', stopCountdown);
        // any click inside the box answers the prompt (or opens the vault
        // chooser) before the timer runs out — stop counting
        btn.closest('#password-toolbar').one('click', stopCountdown);
        return stopCountdown;
    }

    function resizeIframe(height) {
        API.runtime.sendMessage(API.runtime.id, {
            method: "passToParent",
            args: {'injectMethod': 'resizeIframe', args: height}
        });
    }

    var default_account;
    var dh = $('#password-doorhanger');
    var stopCancelCountdown = function () {};

    function editMinedTitle(data, account) {
        stopCancelCountdown();
        var toolbar = dh.find('#password-toolbar');
        toolbar.find('.select_account').stop(true, true).hide();
        resizeIframe(0);
        toolbar.children('.passman-btn').hide();
        toolbar.addClass('editing-title');

        var form = $('<form>', {class: 'title-form'});
        var input = $('<input>', {
            type: 'text',
            class: 'credential-title',
            'aria-label': API.i18n.getMessage('label'),
            autocomplete: 'off'
        }).val(data.label || '').appendTo(form);
        var cancel = $('<button>', {type: 'button', class: 'passman-btn btn-cancel'})
            .text(API.i18n.getMessage('cancel')).appendTo(form);
        var save = $('<button>', {type: 'submit', class: 'passman-btn btn-save btn-success'})
            .text(API.i18n.getMessage('save')).appendTo(form);
        var saving = false;

        function validateTitle() {
            save.prop('disabled', !input.val().trim());
        }
        input.on('input', validateTitle);
        validateTitle();
        cancel.on('click', function () {
            btn_config.cancel().onClickFn();
        });
        form.on('submit', function (e) {
            e.preventDefault();
            if (saving || !input.val().trim()) {
                return;
            }
            saving = true;
            form.hide();
            toolbar.removeClass('editing-title');
            toolbar.find('.toolbar-text').text(API.i18n.getMessage('saving_to', [account.vault.name]) + '...');
            API.runtime.sendMessage(API.runtime.id, {
                method: 'saveMined',
                args: {account: account, label: input.val()}
            }).catch(function () {
                saving = false;
                toolbar.find('.toolbar-text').text(API.i18n.getMessage('error'));
                toolbar.addClass('editing-title');
                form.show();
                input.trigger('focus');
            });
        });
        toolbar.append(form);
        input.trigger('focus');
        input[0].select();
    }

    var btn_config = {
        'cancel': function () {
            return {
                text: API.i18n.getMessage('cancel'),
                onClickFn: function () {
                    closeDoorhanger();
                    API.runtime.sendMessage(API.runtime.id, {method: "clearMined"});
                }
            };
        },
        'save': function (data) {
            var save = API.i18n.getMessage('save');
            var update = API.i18n.getMessage('update');
            var btnText = (data.guid === null) ? save : update;
            return {
                text: btnText,
                onClickFn: function (account) {
                    if (data.guid === null) {
                        editMinedTitle(data, account);
                        return;
                    }
                    API.runtime.sendMessage(API.runtime.id, {method: "saveMined", args: {account: account}}).catch(function () {
                        // the write failed — restore the buttons and say so
                        // instead of hanging on "Saving to …" forever
                        dh.find('.toolbar-text').text(API.i18n.getMessage('error'));
                        dh.find('.passman-btn').show();
                    });
                    dh.find('.toolbar-text').text(API.i18n.getMessage('saving_to', [account.vault.name]) + '...');
                    dh.find('.passman-btn').hide();
                },
                isCreate: (data.guid === null)
            };
        },
        'updateUrl': function (data) {
            return {
                text: API.i18n.getMessage('update'),
                onClickFn: function () {
                    API.runtime.sendMessage(API.runtime.id, {method: "updateCredentialUrl", args: data}).catch(function () {
                        // the write failed — restore the buttons and say so
                        dh.find('.toolbar-text').text(API.i18n.getMessage('error'));
                        dh.find('.passman-btn').show();
                    });
                    dh.find('.toolbar-text').text(API.i18n.getMessage('saving'));
                    dh.find('.passman-btn').hide();
                }
            };
        },
        'ignore': function (data) {
            return {
                text: API.i18n.getMessage('ignore_site'),
                onClickFn: function () {
                    //closeToolbar();
                    API.runtime.sendMessage(API.runtime.id, {method: "ignoreSite", args: data.currentLocation});
                    dh.find('.toolbar-text').text(API.i18n.getMessage('site_ignored'));
                    dh.find('.passman-btn').hide();
                    setTimeout(function () {
                        closeDoorhanger();
                    }, 3000);
                }
            };
        }
    };

    API.runtime.sendMessage(API.runtime.id, {method: "getRuntimeSettings"}).then(function (settings) {
        var accounts = settings.accounts;
        default_account = accounts[0];
        API.runtime.sendMessage(API.runtime.id, {method: "getDoorhangerData"}).then(function (data) {
            if (!data) {
                return;
            }
            var buttons = data.buttons;
            data = data.data;
            var username = (data.username) ? data.username : data.email;
            var doorhanger_div = $('<div id="password-toolbar" style="display: none;">');
            var text_span = $('<span>', {class: 'toolbar-text'});
            if (data.selfAdded) {
                text_span.text(API.i18n.getMessage('credential_saved'));
            } else {
                // "<b>title</b> username <b>at</b> url" — the connector word
                // is lifted out of the localized user_at_site message with
                // sentinel substitutions, so every locale keeps its own
                // wording and word order; anything unexpected falls back to
                // the plain one-string rendering
                var U = '\u0001', S = '\u0002';
                var template = API.i18n.getMessage('user_at_site', [U, S]);
                var at_start = template.indexOf(U), at_end = template.indexOf(S);
                if (at_start > -1 && at_end > at_start) {
                    text_span.append($('<b>').text(data.title));
                    text_span.append(document.createTextNode(' ' + template.substring(0, at_start) + username));
                    text_span.append($('<b>').text(template.substring(at_start + 1, at_end)));
                    text_span.append(document.createTextNode(data.url + template.substring(at_end + 1)));
                } else {
                    text_span.text(data.title + ' ' + API.i18n.getMessage('user_at_site', [username, data.url]));
                }
            }
            text_span.appendTo(doorhanger_div);

            $.each(buttons, function (k, button) {
                var btn = button;

                button = btn_config[btn](data);
                var html_button;

                if (btn === 'save') {
                    var btn_text = (button.isCreate && accounts.length > 1) ? API.i18n.getMessage('save_to','') : API.i18n.getMessage('save');
                    btn_text = (!button.isCreate) ? API.i18n.getMessage('update') : btn_text;
                    html_button = $('<button class="passman-btn btn-save btn-success"></button>').append('<span class="btn-txt"></span>');
                    html_button.find('.btn-txt').text(btn_text);
                    html_button.click(function () {
                        button.onClickFn(default_account);
                    });

                    if (button.isCreate && accounts.length > 1) {
                        var caret_container =  $('<span class="passman-btn caret-container" role="button" tabindex="0"></span>').append('<span class="caret-container-txt"></span>');
                        caret_container.find('.caret-container-txt').text(default_account.vault.name);
                        var caret = $('<span class="fa fa-caret-down" style="margin-left: 5px; cursor: pointer;"></span>');
                        var menu = $('<div class="select_account" style="display: none;"></div>');
                        caret_container.append(caret);
                        doorhanger_div.append(caret_container);
                        for (var i = 1; i < accounts.length; i++) {
                            var a = accounts[i];
                            var item = $('<div class="account" role="button" tabindex="0"></div>').text(API.i18n.getMessage('save_to', [a.vault.name]));
                            /* jshint ignore:start */
                            (function (account, item) {
                                item.click(function (e) {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    button.onClickFn(account);
                                });
                            })(a, item);
                            /* jshint ignore:end */
                            menu.append(item);
                        }
                        caret_container.click(function (e) {
                            e.stopPropagation();
                            e.preventDefault();
                            var isVisible = ($('.select_account').is(':visible'));
                            var height = (isVisible) ? 0 : accounts.length * 29;
                            if (!isVisible) {
                                resizeIframe(height);
                            }
                            menu.slideToggle(function () {
                                if(isVisible){
                                    resizeIframe(height);
                                }
                            });
                        });
                        caret.after(menu);
                    }

                } else {
                    html_button = $('<button></button>',
                        {
                            class: 'passman-btn btn-'+ btn
                        }
                    ).append('<span class="btn-text"></span>');
                    html_button.find('.btn-text').text(button.text);
                    html_button.click(function () {
                        button.onClickFn();
                    });

                }
                doorhanger_div.append(html_button);

            });
            dh.html(doorhanger_div);
            doorhanger_div.slideDown();
            var cancel_btn = doorhanger_div.find('.btn-cancel');
            if (cancel_btn.length) {
                stopCancelCountdown = startCancelCountdown(cancel_btn);
            }
        });
    });
    var _this = {};

    function minedLoginSaved(args) {
        // If the login added by the user then this is true

        var saved = API.i18n.getMessage('credential_saved');
        var updated = API.i18n.getMessage('credential_updated');
        var action = (args.updated) ? updated : saved;
        $('#password-toolbar').find('.toolbar-text').text(action + '!');
        setTimeout(function () {
            closeDoorhanger();
        }, 2500);

    }

    _this.minedLoginSaved = minedLoginSaved;
    API.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        //console.log('Method call', msg.method);
        if (_this[msg.method]) {
            _this[msg.method](msg.args, sender);
        }
    });
});
