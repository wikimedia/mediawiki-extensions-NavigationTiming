/*!
 * JavaScript module for logging client-side latency measurements.
 * @see https://mediawiki.org/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v2 or later
 * @author Ori Livneh <ori@wikimedia.org>
 */
( function ( mw, $ ) {
	'use strict';

	var timing, navigation, mediaWikiLoadEnd,
		TYPE_NAVIGATE = 0;

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
	 * Assert that the attribute order complies with the W3C spec
	 *
	 * @return {boolean}
	 */
	function isCompliant() {
		// Tests derived from
		// <http://w3c-test.org/navigation-timing/test_timing_attributes_order.html>
		return (
			timing                                                                  &&
			timing.loadEventEnd               >= timing.loadEventStart              &&
			timing.loadEventStart             >= timing.domContentLoadedEventEnd    &&
			timing.domContentLoadedEventEnd   >= timing.domContentLoadedEventStart  &&
			timing.domContentLoadedEventStart >= timing.domInteractive              &&
			timing.domInteractive             >= timing.responseEnd                 &&
			timing.responseEnd                >= timing.responseStart               &&
			timing.responseStart              >= timing.requestStart                &&
			timing.requestStart               >= timing.connectEnd                  &&
			timing.connectEnd                 >= timing.connectStart                &&
			timing.connectStart               >= 0
		);
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

		if ( mw.config.get( 'wgMFLazyLoadImages' ) ) {
			event.lazyLoadImages = 'A';
		}

		if ( window.mediaWikiLoadStart ) {
			event.mediaWikiLoadComplete = Math.round( mediaWikiLoadEnd - mediaWikiLoadStart );
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
		if ( inSample() ) {
			emitNavigationTiming();
		}
		mw.hook( 'postEdit' ).add( emitSaveTiming );
	} );

}( mediaWiki, jQuery ) );
