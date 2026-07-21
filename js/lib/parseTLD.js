var parse_host = function(host){
    /** global: tlds */
    if(typeof tlds === "undefined"){
        throw new Error('No TLDs!');
    }

    // a trailing dot (FQDN form, e.g. "example.com.") shifts every label
    // and broke the TLD lookup — strip it before splitting
    host = host.replace(/\.+$/, '');

    var parts = host.split(".");
    var stack = "";
    var tld_level = 1; //unknown tld are 1st level
    for(var i=parts.length-1, part;i>=0;i--){
        part = parts[i];
        stack = stack ? part + "." + stack : part;
        // exception rule ("!city.kobe.jp"): the stack itself is no suffix —
        // the suffix is the stack minus its leftmost label
        if(tlds["!"+stack]){
            tld_level = tlds["!"+stack];
            break;
        }
        if(tlds[stack]){
            tld_level = tlds[stack];
            continue;
        }
        // wildcard rule ("*.ck"): any single label under the parent is a
        // suffix. No break on a miss — deeper stacks may still match (the
        // list carries rules like s3.amazonaws.com under a rule-less
        // amazonaws.com); the deepest matching rule wins
        var cut = stack.indexOf(".");
        if(cut !== -1 && tlds["*."+stack.slice(cut+1)]){
            tld_level = tlds["*."+stack.slice(cut+1)];
        }
    }
    if(parts.length <= tld_level ) {
        return {
            tld: null,
            domain: host
        };
    } else {
        return  {
            tld     : parts.slice(-tld_level).join('.'),
            domain  : parts.slice(-tld_level-1).join('.'),
            sub     : parts.slice(0, (-tld_level-1)).join('.'),
        };
    }


};