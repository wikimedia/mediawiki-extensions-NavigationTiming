NavigationTiming
----------------

NavigationTiming is a MediaWiki extension for logging perceived latency
measurements, exposed by browsers as part of the Navigation Timing API.

Example configuration:

<pre lang="php">
// Dependency
wfLoadExtension('EventLogging');
$wgEventLoggingBaseUri = '/event';

wfLoadExtension('NavigationTiming');
$wgNavigationTimingSamplingFactor = 100; // log 1:100 requests
</pre>

For more information, see the extension's documentation on mediawiki.org:

https://www.mediawiki.org/wiki/Extension:NavigationTiming
