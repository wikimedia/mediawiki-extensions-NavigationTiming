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

	/** Assert that the attribute order complies with the W3C spec. **/
	function isCompliant() {
		// Tests derived from <http://w3c-test.org/web-platform-tests/
		//   master/navigation-timing/test_timing_attributes_order.html>
		var attr, current, last = 0, order = [
			'loadEventEnd',
			'loadEventStart',
			'domContentLoadedEventEnd',
			'domContentLoadedEventStart',
			'domInteractive',
			'responseEnd',
			'responseStart',
			'requestStart',
			'connectEnd',
			'connectStart'
		];

		while ( ( attr = order.pop() ) !== undefined ) {
			current = timing[attr];
			if ( current < 0 || current < last ) {
				return false;
			}
			last = current;
		}
		return true;
	}

	function emitTiming() {
		// Workaround for IE 9 bug: IE 9 sets a default value of zero for
		// navigationStart, rather than use fetchStart as the specification
		// requires. See <https://bugzilla.wikimedia.org/46474> for details.
		var navStart = timing.navigationStart || timing.fetchStart,
			event = {
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
			sending    : timing.fetchStart - navStart,
			waiting    : timing.responseStart - timing.requestStart,
			receiving  : timing.responseEnd - timing.responseStart,
			rendering  : timing.loadEventEnd - timing.responseEnd,
			loading    : timing.loadEventStart - navStart
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

		if ( mw.mobileFrontend && mw.config.exists( 'wgMFMode' ) ) {
			event.mobileMode = mw.config.get( 'wgMFMode' );
		}

		if ( isCompliant() ) {
			mw.eventLog.logEvent( 'NavigationTiming', event );
		}
	}

	// The Navigation Timing API is broken in Firefox 7 and 8 and reports
	// inaccurate measurements. See <https://bugzilla.mozilla.org/691547>.

	if ( timing
		&& performance.navigation.type === 0
		&& inSample()
		&& !/Firefox\/[78]/.test( navigator.userAgent )
	) {
		// ensure we run after loadEventEnd.
		$( window ).load( function () {
			setTimeout( emitTiming, 0 );
		} );
	}

} ( mediaWiki, jQuery ) );
