var observeDOM = (function(){
    var MutationObserver = window.MutationObserver || window.WebKitMutationObserver,
        eventListenerSupported = window.addEventListener;

    return function(obj, callback){
        if( MutationObserver ){
            // define a new observer
            var obs = new MutationObserver(function(mutations, observer){
                // check every record, not just the first: a batch often
                // opens with an unrelated mutation while a later record
                // carries the change that matters
                for (var i = 0; i < mutations.length; i++) {
                    if( mutations[i].type === 'attributes' || mutations[i].addedNodes.length || mutations[i].removedNodes.length ){
                        callback();
                        return;
                    }
                }
            });
            // besides child changes, watch the attributes through which
            // pages reveal hidden login fields or retype password boxes
            // (show/hide toggles) — neither adds nor removes a node
            obs.observe( obj, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['type', 'class', 'style', 'hidden', 'disabled']
            });
        }
        else if( eventListenerSupported ){
            obj.addEventListener('DOMNodeInserted', callback, false);
            obj.addEventListener('DOMNodeRemoved', callback, false);
        }
    };
})();
