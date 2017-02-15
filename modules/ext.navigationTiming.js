/*!
 * JavaScript module for logging client-side latency measurements.
 * @see https://mediawiki.org/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v2 or later
 * @author Ori Livneh <ori@wikimedia.org>
 */
( function ( mw, $ ) {
	'use strict';

	var timing, navigation, mediaWikiLoadEnd, hiddenProp, visibilityEvent,
		visibilityChanged = false,
		TYPE_NAVIGATE = 0;

	if ( window.performance ) {
		timing = performance.timing;
		navigation = performance.navigation;
	}

	// Don't report measurements for pages that have loaded in the background.
	// Browsers defer or deprioritize loading background pages, causing them to
	// take longer to load, which throws off our measurements.
	// See <https://phabricator.wikimedia.org/T146510#2794213> for more details.
	if ( typeof document.hidden !== 'undefined' ) {
		hiddenProp = 'hidden';
		visibilityEvent = 'visibilitychange';
	} else if ( typeof document.mozHidden !== 'undefined' ) {
		hiddenProp = 'mozHidden';
		visibilityEvent = 'mozvisibilitychange';
	} else if ( typeof document.msHidden !== 'undefined' ) {
		hiddenProp = 'msHidden';
		visibilityEvent = 'msvisibilitychange';
	} else if ( typeof document.webkitHidden !== 'undefined' ) {
		hiddenProp = 'webkitHidden';
		visibilityEvent = 'webkitvisibilitychange';
	}
	if ( hiddenProp ) {
		$( document ).one( visibilityEvent, function () {
			visibilityChanged = true;
		} );
		if ( document[ hiddenProp ] ) {
			visibilityChanged = true;
		}
	}

	function inSample() {
		var factor = mw.config.get( 'wgNavigationTimingSamplingFactor' );
		if ( !$.isNumeric( factor ) || factor < 1 ) {
			return false;
		}
		return Math.floor( Math.random() * factor ) === 0;
	}

	function getDevicePixelRatio() {
		if ( window.screen && screen.logicalXDPI ) {
			// IE10 mobile; see <http://stackoverflow.com/q/16383503/582542>
			return screen.deviceXDPI / screen.logicalXDPI;
		} else if ( window.devicePixelRatio ) {
			return window.devicePixelRatio;
		} else {
			return 1;
		}
	}

	/**
	 * Check if the order of Navigation Timing marker values conforms
	 * to the specification.
	 *
	 * Markers may be undefined or zero if they are not implemented or not
	 * applicable to the current page.  Markers which have a value must be
	 * in ascending order.
	 *
	 * @return {boolean}
	 */
	function isCompliant() {
		var sequences, markers, curr, prev;

		if ( !timing ) {
			return false;
		}

		sequences = [ [
			'navigationStart',
			'fetchStart',
			'domainLookupStart',
			'domainLookupEnd',
			'connectStart',
			'connectEnd',
			'requestStart',
			'responseStart',
			'responseEnd',
			'domInteractive',
			'domContentLoadedEventStart',
			'domContentLoadedEventEnd',
			'loadEventStart',
			'loadEventEnd'
		], [
			'secureConnectionStart',
			'requestStart'
		], [
			'fetchStart',
			'domLoading'
		], [
			'domContentLoadedEventEnd',
			'domComplete'
		] ];

		while ( sequences.length ) {
			markers = sequences.shift();
			prev = null;
			while ( markers.length ) {
				curr = timing[ markers.shift() ];
				if ( curr ) {
					if ( curr < prev ) {
						return false;
					}
					prev = curr;
				}
			}
		}

		return true;
	}

	function getNavTiming() {
		var navStart, timingData, chromeLoadTimes;

		// Only record data on TYPE_NAVIGATE (e.g. ignore TYPE_RELOAD)
		// Only record data if implementation is compliant
		if ( !navigation || navigation.type !== TYPE_NAVIGATE || !isCompliant() ) {
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
			'domComplete',
			'domInteractive',
			'fetchStart',
			'loadEventEnd',
			'loadEventStart',
			'requestStart',
			'responseEnd',
			'responseStart',
			'secureConnectionStart'
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

		if ( timing.msFirstPaint > navStart ) {
			timingData.firstPaint = timing.msFirstPaint - navStart;
		/* global chrome */
		} else if ( window.chrome && $.isFunction( chrome.loadTimes ) ) {
			chromeLoadTimes = chrome.loadTimes();
			if ( chromeLoadTimes.firstPaintTime > chromeLoadTimes.startLoadTime ) {
				timingData.firstPaint = Math.round( 1000 *
					( chromeLoadTimes.firstPaintTime - chromeLoadTimes.startLoadTime ) );
			}
		}

		return timingData;
	}

	function emitNavigationTiming() {
		var event = {
				isHttp2: /H2/.test( $.cookie( 'CP' ) ),
				isHiDPI: getDevicePixelRatio() > 1,
				isAnon: mw.config.get( 'wgUserId' ) === null,
				mediaWikiVersion: mw.config.get( 'wgVersion' )
			},
			page = {
				pageId: mw.config.get( 'wgArticleId' ),
				namespaceId: mw.config.get( 'wgNamespaceNumber' ),
				revId: mw.config.get( 'wgCurRevisionId' ),
				action: mw.config.get( 'wgAction' ) // view, submit, etc.
			},
			isSpecialPage = !!mw.config.get( 'wgCanonicalSpecialPageName' ),
			mobileMode = mw.config.get( 'wgMFMode' );

		if ( window.mediaWikiLoadStart ) {
			/* global mediaWikiLoadStart */
			event.mediaWikiLoadComplete = Math.round( mediaWikiLoadEnd - mediaWikiLoadStart );
		}

		if ( window.Geo ) {
			/* global Geo */
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
		if ( navigation && navigation.type === TYPE_NAVIGATE && !isCompliant() ) {
			// Keep track of non-compliant browsers (only on TYPE_NAVIGATE)
			mw.eventLog.logFailure( 'NavigationTiming', 'nonCompliant' );
		}

		mw.eventLog.logEvent( 'NavigationTiming', event );
	}

	function emitSaveTiming() {
		var navTiming;
		if ( !mw.config.get( 'wgPostEdit' ) ) {
			return;
		}

		navTiming = getNavTiming();
		if ( navTiming.responseStart ) {
			mw.eventLog.logEvent( 'SaveTiming', {
				mediaWikiVersion: mw.config.get( 'wgVersion' ),
				saveTiming: navTiming.responseStart
			} );
		}
	}

	function onLoadComplete( callback ) {
		mw.hook( 'resourceloader.loadEnd' ).add( function () {
			var timer;
			mediaWikiLoadEnd = mw.now();
			timer = setInterval( function () {
				if ( !timing || timing.loadEventEnd > 0 ) {
					clearInterval( timer );
					callback();
				}
			}, 10 );
		} );
	}

	// Ensure we run after loadEventEnd.
	onLoadComplete( function () {
		if ( inSample() && !visibilityChanged ) {
			emitNavigationTiming();
		}
		mw.hook( 'postEdit' ).add( emitSaveTiming );
	} );

	if ( typeof QUnit !== 'undefined' ) {
		/**
		 * For testing only. Subject to change any time.
		 *
		 * @private
		 */
		module.exports = {
			emitNavTiming: emitNavigationTiming,
			reinit: function () {
				// performance is recursively read-only and can only be
				// mocked from the top down via window.performance. The test
				// needs to force this module to re-resolve this cached
				// reference. See ext.navigationTiming.test.js
				navigation = performance.navigation;
			}
		};
	}

}( mediaWiki, jQuery ) );
