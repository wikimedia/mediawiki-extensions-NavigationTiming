/**
 * JavaScript for the Navigation Timing MediaWiki extension.
 * @see https://secure.wikimedia.org/wikipedia/mediawiki/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v3 or later
 * @author Patrick Reilly <preilly@wikimedia.org>
 */

( function ( mw, $ ) {
	var timing;

	var performance = mw.performance = { timing: {}, navigation: {}, memory: {} };
	$.extend( performance, window.performance, window.mozPerformance,
		window.msPerformance, window.webkitPerformance );

	var timing, navigation, timingBase64Str, navigationBase64Str, timingSHA1,
		navigationSHA1, eventString;

	timing = JSON.stringify( performance.timing || {}, null, 2 );
	navigation = JSON.stringify( performance.navigation || {}, null, 2 );
	timingBase64Str = $().crypt( { method:"b64enc",
		source:timing } );
	timingSHA1 = $().crypt( { method:"sha1",
		source:timing } );
	eventString = timingSHA1 + '::' +  timingBase64Str;

	if ( mw.config.get( 'debug' ) ) {
		mw.log( 'json: ' + timing );
		mw.log( 'json: ' + navigation );
		mw.log( 'json in base64: ' + timingBase64Str );
		mw.log( 'json sha1: ' + timingSHA1 );
		mw.log( 'event string: ' + eventString );
	}

}( mediaWiki, jQuery ) );
