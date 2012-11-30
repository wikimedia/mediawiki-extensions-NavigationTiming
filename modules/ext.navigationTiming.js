/**
 * JavaScript for the Navigation Timing MediaWiki extension.
 * @see https://secure.wikimedia.org/wikipedia/mediawiki/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v3 or later
 * @author Patrick Reilly <preilly@wikimedia.org>
 */

mw.navigationTiming = ( function( $ ) {
function init() {
	var timing, navigation, timingBase64Str, navigationBase64Str, timingSHA1, navigationSHA1, eventString;
	if ( typeof JSON !== 'undefined' ) {
		timing = JSON.stringify( performance.timing || {} );
		navigation = JSON.stringify( performance.navigation || {} );
		timingBase64Str = $().crypt( { method:"b64enc",
			source:timing } );
		timingSHA1 = $().crypt( { method:"sha1",
			source:timing } );
		eventString = timingSHA1 + '::' +  timingBase64Str;
		if ( window.console ) {
			console.log( 'json: ' + timing );
			console.log( 'json: ' + navigation );
			console.log( 'json in base64: ' + timingBase64Str );
			console.log( 'json sha1: ' + timingSHA1 );
			console.log( 'event string: ' + eventString );
		}
	}
}

return {
	init: init
};
} )( jQuery );
