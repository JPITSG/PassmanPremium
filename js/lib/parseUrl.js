function processURL(URL, ignoreProtocol, ignoreSubdomain, ignorePath, ignorePort) {
    if (URL === null || URL === "") {
        return URL;
    }

    var parser = document.createElement('a');
    parser.href = URL;


    var protocol = parser.protocol;
    var host = parser.hostname;
    var path = parser.pathname;
    var port = parser.port;
    if (host === null || host === "") {
        return URL;
    }

    var splittedURL = host.split(".");
    var isIP = false;
    if (splittedURL.length === 4) {
        isIP = true;
        for (var i = 0; i < splittedURL.length; i++) {
            if (isNaN(splittedURL[i]) || splittedURL[i] < 0 || splittedURL[i] > 255) {
                isIP = false;
                break;
            }
        }
    }
    var baseHost = null;
    if (isIP) {
        baseHost = host;
    }
    else {
        var tld = parse_host(host);
        if(tld) {
            baseHost = tld.domain;
        }
        // hosts the TLD parser can't handle (localhost, intranet names,
        // *.local, IPv6) — fall back to the full host instead of the
        // string "null", which made all of them match each other
        if (!baseHost) {
            baseHost = host;
        }
    }
    var returnURL = "";
    if (!ignoreProtocol) {
        returnURL += protocol + "//";
    }

    if (!ignoreSubdomain) {
        returnURL += host;
    }
    else {
        returnURL += baseHost;//return the hostname and the tld of the website if ignoreSubdomain is check
    }

    // the port is only ever appended here, so ignoring it simply means
    // not appending it (the old replace() branch was a no-op)
    if (!ignorePort && port) {
        returnURL += ':' + port;
    }

    if (!ignorePath && path !== null && path) {
        returnURL += path;
    }
    if (returnURL.slice(-1) === "/") {
        returnURL = returnURL.slice(0, -1);
    }
    return returnURL;
}
