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

	function inSample() {
		var factor = mw.config.get( 'wgNavigationTimingSamplingFactor' );
		if ( !$.isNumeric( factor ) || factor < 1 ) {
			return false;
		}
		return Math.floor( Math.random() * factor ) === 0;
	}

	function emitTiming() {
		var event = {
				userAgent : navigator.userAgent,
				isHttps   : location.protocol === 'https:',
				isAnon    : mw.config.get( 'wgUserId' ) === null
			},
			page = {
				pageId : mw.config.get( 'wgArticleId' ),
				revId  : mw.config.get( 'wgCurRevisionId' ),
				action : mw.config.get( 'wgAction' )  // view, submit, etc.
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
			rendering  : timing.loadEventEnd - timing.responseEnd,
			loading    : timing.loadEventStart - timing.navigationStart
		}, function ( k, v ) {
			if ( $.isNumeric( v ) && v > 0 ) {
				event[ k ] = v;
			}
		} );

		if ( timing.redirectStart ) {
			event.redirectCount = performance.navigation.redirectCount;
			event.redirecting = timing.redirectEnd - timing.redirectStart;
		}

		// Omit page information for special pages: they don't have real page
		// IDs or revisions. (They appear as 0 to client-side code.)
		if ( page.revId ) {
			$.extend( event, page );
		}

		mw.eventLog.logEvent( 'NavigationTiming', event );
	}

	// The Navigation Timing API is broken in Firefox 7 and 8 and reports
	// inaccurate measurements. See <https://bugzilla.mozilla.org/691547>.

	if ( timing && inSample() && !/Firefox\/[78]/.test( navigator.userAgent ) ) {
		// ensure we run after loadEventEnd.
		$( window ).load( function () {
			setTimeout( emitTiming, 0 );
		} );
	}

} ( mediaWiki, jQuery ) );
