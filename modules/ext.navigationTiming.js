/*!
 * JavaScript module for logging client-side latency measurements.
 * @see https://mediawiki.org/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v2 or later
 * @author Ori Livneh <ori@wikimedia.org>
 */
( function ( mw, $ ) {
	'use strict';

	var timing, navigation;

	if ( window.performance ) {
		timing = performance.timing;
		navigation = performance.navigation;
	}

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
		// master/navigation-timing/test_timing_attributes_order.html>
		var attr, current,
			last = 0,
			order = [
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

		if ( !timing || !performance ) {
			// Browser does not implement the Navigation Timing API.
			return false;
		}

		if ( /Firefox\/[78]\b/.test( navigator.userAgent ) ) {
			// The Navigation Timing API is broken in Firefox 7 and 8 and reports
			// inaccurate measurements. See <https://bugzilla.mozilla.org/691547>.
			return false;
		}

		while ( ( attr = order.pop() ) !== undefined ) {
			current = timing[ attr ];
			if ( current < 0 || current < last ) {
				return false;
			}
			last = current;
		}
		return true;
	}

	function getPaintTiming() {
		var firstPaint, relativeTo;

		if ( window.chrome && $.isFunction( chrome.loadTimes ) ) {
			// Chrome
			firstPaint = chrome.loadTimes().firstPaintTime * 1000;
			relativeTo = chrome.loadTimes().startLoadTime * 1000;
		} else if ( timing && timing.msFirstPaint ) {
			// Internet Explorer 9+ (<http://msdn.microsoft.com/ff974719>)
			firstPaint = timing.msFirstPaint;
			relativeTo = timing.navigationStart;
		}

		if ( firstPaint > relativeTo ) {
			return { firstPaint: Math.round( firstPaint - relativeTo ) };
		}
	}

	function getNavTiming() {
		var navStart, timingData;

		if ( !isCompliant() || navigation.type !== 0 ) {
			return {};
		}

		// Workaround for IE 9 bug: IE 9 sets a default value of zero for
		// navigationStart, rather than use fetchStart as the specification
		// requires. See <https://bugzilla.wikimedia.org/46474> for details.
		navStart = timing.navigationStart || timing.fetchStart;
		timingData = {};

		$.each( [
			'connectEnd',
			'connectStart',
			'domainLookupStart',
			'domainLookupEnd',
			'domComplete',
			'domContentLoadedEventStart',
			'domContentLoadedEventEnd',
			'domInteractive',
			'domLoading',
			'fetchStart',
			'loadEventEnd',
			'loadEventStart',
			'redirectStart',
			'redirectEnd',
			'requestStart',
			'responseEnd',
			'responseStart',
			'secureConnectionStart',
			'unloadEventStart',
			'unloadEventEnd'

		], function ( i, marker ) {
			var measure = timing[ marker ] - navStart;
			if ( $.isNumeric( measure ) && measure > 0 ) {
				timingData[ marker ] = measure;
			}
		} );

		if ( timing.domainLookupStart ) {
			timingData.dnsLookup = timing.domainLookupEnd - timing.domainLookupStart;
		}

		if ( timing.redirectStart ) {
			timingData.redirectCount = performance.navigation.redirectCount;
			timingData.redirecting = timing.redirectEnd - timing.redirectStart;
		}

		$.extend( timingData, getPaintTiming() );

		return timingData;
	}

	function emitNavigationTiming() {
		var mediaWikiLoadEnd = mw.now ? mw.now() : new Date().getTime(),
			event = {
				isHttps: location.protocol === 'https:',
				isAnon: mw.config.get( 'wgUserId' ) === null
			},
			page = {
				pageId: mw.config.get( 'wgArticleId' ),
				namespaceId: mw.config.get( 'wgNamespaceNumber' ),
				revId: mw.config.get( 'wgCurRevisionId' ),
				action: mw.config.get( 'wgAction' ) // view, submit, etc.
			},
			isSpecialPage = !!mw.config.get( 'wgCanonicalSpecialPageName' ),
			mobileMode = mw.config.get( 'wgMFMode' ),
			wikiLoadstartPoint;

		// check startup.js for startup time
		performance.mark( 'mwLoadEnd' );

		if ( window.mediaWikiLoadStart ) {
			wikiLoadstartPoint = timing.navigationStart || timing.fetchStart;
			event.mediaWikiLoadStart = Math.round( mediaWikiLoadStart - wikiLoadstartPoint );
			event.mediaWikiLoadEnd =  Math.round( mediaWikiLoadEnd - wikiLoadstartPoint );
		}

		if ( window.Geo ) {
			if ( typeof Geo.country === 'string' ) {
				event.originCountry = Geo.country;
			}

			if ( typeof Geo.region === 'string' ) {
				event.originRegion = Geo.region;
			}
		}

		// Omit page information for special pages: they don't have real page
		// IDs or revisions. (They appear as 0 to client-side code.)
		if ( !isSpecialPage ) {
			$.extend( event, page );
		}

		if ( typeof mobileMode === 'string' && mobileMode.indexOf( 'desktop' ) === -1 ) {
			event.mobileMode = mobileMode;
		}

		$.extend( event, getNavTiming() );

		mw.eventLog.logEvent( 'NavigationTiming', event );
	}

	function emitSaveTiming() {
		var navTiming;

		if ( !mw.config.get( 'wgPostEdit' ) ) {
			return;
		}

		navTiming = getNavTiming();
		if ( navTiming && navTiming.responseStart ) {
			mw.eventLog.logEvent( 'SaveTiming', {
				saveTiming: navTiming.responseStart
			} );
		}
	}

	// Ensure we run after loadEventEnd.
	$( window ).load( function () {
		setTimeout( function () {
			if ( inSample() ) {
				emitNavigationTiming();
			}
			mw.hook( 'postEdit' ).add( emitSaveTiming );
		} );
	} );

}( mediaWiki, jQuery ) );
