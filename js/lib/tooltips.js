/* Styled tooltips shared by the popup, password picker and in-page icon. */

(function () {
    'use strict';

    var TIP_DELAY = 320;
    var TIP_GAP = 8;
    var TIP_EDGE = 8;
    var TIP_ARROW_INSET = 14;

    var tipEl = null;
    var tipTarget = null;
    var tipTimer = 0;
    var managedLabels = new WeakSet();
    var attachedTargets = new WeakSet();
    var closeListenersInstalled = false;
    var delegatedListenersInstalled = false;

    function tipTriggerAt(node) {
        while (node && node.nodeType === 1) {
            if (node.hasAttribute('data-tip')) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
    }

    function isInteractive(el) {
        var role = el.getAttribute('role');
        return el.localName === 'button' || role === 'button' || role === 'tab';
    }

    // Native title tooltips used to double as accessible names for icon-only
    // controls. Keep that useful part without keeping the native tooltip.
    function syncTipName(el) {
        if (!el || !isInteractive(el)) {
            return;
        }
        var text = el.getAttribute('data-tip') || '';
        if (!text) {
            if (managedLabels.has(el)) {
                el.removeAttribute('aria-label');
                managedLabels.delete(el);
            }
            return;
        }
        if (!el.hasAttribute('aria-label') || managedLabels.has(el)) {
            el.setAttribute('aria-label', text);
            managedLabels.add(el);
        }
    }

    function syncTree(root) {
        if (!root || root.nodeType !== 1) {
            return;
        }
        if (root.hasAttribute('data-tip')) {
            syncTipName(root);
        }
        var triggers = root.querySelectorAll('[data-tip]');
        for (var i = 0; i < triggers.length; i++) {
            syncTipName(triggers[i]);
        }
    }

    function ensureTipElement() {
        if (tipEl || !document.body) {
            return tipEl;
        }
        tipEl = document.createElement('div');
        tipEl.className = 'passman-tooltip';
        tipEl.setAttribute('role', 'tooltip');
        tipEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(tipEl);
        return tipEl;
    }

    function closeTip() {
        clearTimeout(tipTimer);
        tipTimer = 0;
        tipTarget = null;
        if (tipEl) {
            tipEl.classList.remove('show');
            tipEl.setAttribute('aria-hidden', 'true');
        }
    }

    function drawTip() {
        tipTimer = 0;
        var target = tipTarget;
        var text = target && target.isConnected ?
            target.getAttribute('data-tip') : '';
        if (!text) {
            closeTip();
            return;
        }
        if (!ensureTipElement()) {
            closeTip();
            return;
        }

        syncTipName(target);
        tipEl.textContent = '';
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = document.createElement('div');
            if (i > 0) {
                line.className = 'passman-tooltip-note';
            }
            line.textContent = lines[i];
            tipEl.appendChild(line);
        }

        // Measure without a stale position affecting the available width.
        tipEl.style.left = '0px';
        tipEl.style.top = '0px';
        var width = tipEl.offsetWidth;
        var height = tipEl.offsetHeight;
        var rect = target.getBoundingClientRect();
        var above = rect.top - TIP_GAP - height >= TIP_EDGE;
        var top = above ?
            rect.top - TIP_GAP - height :
            Math.min(rect.bottom + TIP_GAP, window.innerHeight - height - TIP_EDGE);
        var center = rect.left + rect.width / 2;
        var left = Math.max(TIP_EDGE, Math.min(
            center - width / 2,
            window.innerWidth - width - TIP_EDGE
        ));
        var arrow = Math.min(
            Math.max(center - left, TIP_ARROW_INSET),
            width - TIP_ARROW_INSET
        );

        tipEl.classList.toggle('below', !above);
        tipEl.style.left = Math.round(left) + 'px';
        tipEl.style.top = Math.round(Math.max(TIP_EDGE, top)) + 'px';
        tipEl.style.setProperty('--passman-tip-arrow', Math.round(arrow) + 'px');
        tipEl.classList.add('show');
        // The trigger's aria-label is the accessible equivalent; hiding this
        // visual duplicate prevents a screen reader announcing it twice.
        tipEl.setAttribute('aria-hidden', 'true');
    }

    function openTip(target, instant) {
        if (!target) {
            closeTip();
            return;
        }
        syncTipName(target);
        if (target === tipTarget) {
            return;
        }
        var wasOpen = tipEl && tipEl.classList.contains('show');
        closeTip();
        tipTarget = target;
        if (instant || wasOpen) {
            drawTip();
        } else {
            tipTimer = setTimeout(drawTip, TIP_DELAY);
        }
    }

    function installCloseListeners() {
        if (closeListenersInstalled) {
            return;
        }
        closeListenersInstalled = true;
        document.addEventListener('click', closeTip, true);
        document.addEventListener('scroll', closeTip, true);
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                closeTip();
            }
        });
        document.documentElement.addEventListener('mouseleave', closeTip);
        window.addEventListener('blur', closeTip);
        window.addEventListener('resize', closeTip);
        window.addEventListener('hashchange', closeTip);
    }

    // Extension documents use delegated events because Angular and the
    // password picker add and replace controls after the initial page load.
    function initDelegated() {
        if (delegatedListenersInstalled || !document.documentElement) {
            return;
        }
        delegatedListenersInstalled = true;
        installCloseListeners();
        syncTree(document.documentElement);

        document.addEventListener('mouseover', function (event) {
            openTip(tipTriggerAt(event.target), false);
        });
        document.addEventListener('focusin', function (event) {
            var target = tipTriggerAt(event.target);
            if (target && (!target.matches || target.matches(':focus-visible'))) {
                openTip(target, true);
            }
        });
        document.addEventListener('focusout', closeTip);

        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(function (mutations) {
                for (var i = 0; i < mutations.length; i++) {
                    var mutation = mutations[i];
                    if (mutation.type === 'attributes') {
                        syncTipName(mutation.target);
                        if (mutation.target === tipTarget &&
                                tipEl && tipEl.classList.contains('show')) {
                            drawTip();
                        }
                    } else {
                        for (var j = 0; j < mutation.addedNodes.length; j++) {
                            syncTree(mutation.addedNodes[j]);
                        }
                    }
                }
            }).observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-tip'],
                childList: true,
                subtree: true
            });
        }
    }

    // Host pages only need tooltips on the Passman field icons. Attaching
    // directly avoids a delegated mouseover listener or DOM observer running
    // over the host site's entire document.
    function attach(target) {
        if (!target || attachedTargets.has(target)) {
            return;
        }
        attachedTargets.add(target);
        installCloseListeners();
        syncTipName(target);
        target.addEventListener('mouseenter', function () {
            openTip(target, false);
        });
        target.addEventListener('mouseleave', closeTip);
        target.addEventListener('focus', function () {
            if (!target.matches || target.matches(':focus-visible')) {
                openTip(target, true);
            }
        });
        target.addEventListener('blur', closeTip);
    }

    window.PassmanTooltips = {
        init: initDelegated,
        attach: attach,
        close: closeTip
    };

    var extensionPage = window.location.protocol === 'moz-extension:' ||
        window.location.protocol === 'chrome-extension:';
    if (extensionPage) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initDelegated);
        } else {
            initDelegated();
        }
    }
}());
