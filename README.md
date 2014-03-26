NavigationTiming
----------------

NavigationTiming is a MediaWiki extension for logging perceived latency
measurements, exposed by browsers as part of the proposed Navigation
Timing API.

Sample configuration:

```
require_once( "$IP/extensions/EventLogging/EventLogging.php" ); // dependency
require_once( "$IP/extensions/NavigationTiming/NavigationTiming.php" );
$wgNavigationTimingSamplingFactor = 10000; // log 1:10,000 requests
```

For more information, see the extension's documentation on MediaWiki.org:

https://www.mediawiki.org/wiki/Extension:NavigationTiming
