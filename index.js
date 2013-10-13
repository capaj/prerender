var phantom = require('phantom'),
    http = require('http'),
    url = require('url'),
    cache = {
        get: function (url, cb) {
            cb(null, null);
        },
        set: function (url, result) {
        }
    };

var getUrl = function(req) {
    if (req.url.indexOf('_escaped_fragment_') ==-1) return req.url;

    var parts = url.parse(req.url, true);

    if(parts.query['_escaped_fragment_']) parts.hash = '#!' + parts.query['_escaped_fragment_'];
    delete parts.query['_escaped_fragment_'];
    delete parts.search;

    return url.format(parts);
};

phantom.create({
    "ignoreSslErrors": true,
    "maxDiskCacheSize": 51000,
    "diskCache": true,
    "loadImages": false
}, {
    binary: require('phantomjs').path
}, function (phantom) {
    http.createServer(function (req, res) {
        var url = getUrl(req).substr(1);
        console.log('getting', url);
        cache.get(url, function (err, result) {
            if (!err && result) {
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(result);
            } else {
                var start = new Date();
                phantom.createPage(function (page) {
                    var pendingRequests = 0;
                    page.set('onResourceRequested', function () {
                        pendingRequests++;
                    });
                    page.set('onResourceReceived', function (response) {
                        if ('end' === response.stage) {
                            pendingRequests--;
                        }
                    });
                    page.set('onResourceError', function() {
                        pendingRequests--;
                    });
                    page.open(url, function (status) {
                        if ('fail' === status) {
                            res.writeHead(404);
                            res.end();
                            page.close();
                        } else {
                            var intervalStart = new Date(), interval = setInterval(function () {
                                var noPending = pendingRequests <= 0, timeout = new Date().getTime() - intervalStart > 10000;
                                if (noPending || timeout) {
                                    clearInterval(interval);
                                    if (noPending) {
                                        page.evaluate(function () {
                                            try {
                                                var html = document && document.getElementsByTagName('html');
                                                if (html && html[0]) {
                                                    return html[0].outerHTML;
                                                }
                                                return '';
                                            } catch (e) {
                                                return '';
                                            }
                                        }, function (documentHTML) {
                                            if (!documentHTML) {
                                                res.writeHead(404);
                                                res.end();
                                            } else {
                                                var matches = documentHTML.match(/<script(?:.*?)>(?:[\S\s]*?)<\/script>/g);
                                                for (var i = 0; matches && i < matches.length; i++) {
                                                    documentHTML = documentHTML.replace(matches[i], '');
                                                }
                                                cache.set(url, documentHTML);
                                                res.writeHead(200, {'Content-Type': 'text/html'});
                                                res.end(documentHTML);
                                                console.log('got', url, 'in', new Date().getTime() - start.getTime() + 'ms')
                                            }
                                            page.close();
                                        });
                                    } else {
                                        res.writeHead(408);
                                        res.end();
                                        page.close();
                                    }
                                }
                            }, 50);
                        }
                    });
                });
            }
        });
    }).listen(process.env.PORT || 3000);
    console.log('Server running on port ' + (process.env.PORT || 3000));
});