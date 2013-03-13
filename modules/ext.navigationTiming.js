/**
 * JavaScript module for logging client-side latency measurements.
 * @see https://mediawiki.org/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v2 or later
 * @author Ori Livneh <ori@wikimedia.org>
 */
( function ( mw, $ ) {
	'use strict';

	var timing = window.performance ? performance.timing : null;

	function getRand( n ) {
		return Math.floor( Math.random() * ( n + 1 ) );
	}

	function inSample() {
		var factor = mw.config.get( 'wgNavigationTimingSamplingFactor' );
		if ( !$.isNumeric( factor ) || factor < 1 ) {
			return false;
		}
		return getRand( factor ) === getRand( factor );
	}

	function emitTiming() {
		var event = {
			userAgent : navigator.userAgent,
			isHttps   : window.location.protocol === 'https:'
		};

		if ( $.isPlainObject( window.Geo ) && typeof Geo.country === 'string' ) {
			event.originCountry = Geo.country;
		}

		$.each( {
			dnsLookup  : timing.domainLookupEnd - timing.domainLookupStart,
			connecting : timing.connectEnd - timing.connectStart,
			sending    : timing.fetchStart - timing.navigationStart,
			waiting    : timing.responseStart - timing.requestStart,
			receiving  : timing.responseEnd - timing.responseStart,
			rendering  : timing.loadEventEnd - timing.responseEnd
		}, function ( k, v ) {
			if ( $.isNumeric( v ) && v > 0 ) {
				event[ k ] = v;
			}
		} );

		if ( timing.redirectStart ) {
			event.redirectCount = performance.navigation.redirectCount;
			event.redirecting = timing.redirectEnd - timing.redirectStart;
		}

		mw.eventLog.logEvent( 'NavigationTiming', event );
	}

	if ( timing && inSample() ) {
		// ensure we run after loadEventEnd.
		window.onload = function () {
			window.setTimeout( emitTiming, 0 );
		};
	}

} ( mediaWiki, jQuery ) );
