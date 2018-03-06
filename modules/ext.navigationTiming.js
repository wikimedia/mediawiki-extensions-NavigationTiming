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
		isInSample, geoOversamples, uaOversamples, oversamples,
		oversampleReasons = [],
		loadEL = false,
		visibilityChanged = false,
		TYPE_NAVIGATE = 0;

	/**
	 * Get random number between 0 (inclusive) and 1 (exclusive).
	 *
	 * @return {number}
	 */
	function getRandom() {
		/* global Uint32Array */
		if ( !window.crypto || typeof Uint32Array !== 'function' ) {
			return Math.random();
		}

		// 4294967295 == 0xffffffff == max unsigned 32-bit integer
		return window.crypto.getRandomValues( new Uint32Array( 1 ) )[ 0 ] / 4294967295;
	}

	/**
	 * Determine result of random sampling.
	 *
	 * Based on ext.eventLogging.subscriber's mw.eventLog.inSample
	 * Duplicated here because we need it without/before dependencies.
	 *
	 * @param {number} factor One in how many should be included. (0=nobody, 1=all, 2=50%)
	 * @return {boolean}
	 */
	function inSample( factor ) {
		if ( typeof factor !== 'number' || factor < 1 ) {
			return false;
		}
		return Math.floor( getRandom() * factor ) === 0;
	}

	/**
	 * Get the pixel ratio of the device.
	 *
	 * @return {number} The pixel ratio of the device, or 1 if unknown
	 */
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

	/**
	 * Get Navigation Timing data from the browser
	 *
	 * @return {Object} timingData with normalized fields
	 */
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
			// Verify the key exists and that it is equal or above zero to avoid submit
			// of invalid/negative values after subtracting navStart.
			// While these keys are meant to be timestamps, they may be absent
			// or 0 where the measured operation did not ocurr.
			// E.g. secureConnectionStart is 0 when the connection is reused (T176105)
			var value = timing[ marker ];
			if ( typeof value === 'number' && value >= 0 ) {
				if ( marker === 'secureConnectionStart' && value === 0 ) {
					timingData[ marker ] = 0;
				} else {
					timingData[ marker ] = value - navStart;
				}
			}
		} );
		// If DNS is cached, it will be marked as start/end matching fetchStart.
		// so this will actually never be 0
		timingData.dnsLookup = timing.domainLookupEnd - timing.domainLookupStart;

		// Watchout: There are some fields that are handled differently than the rest
		// * redirectStart/redirectEnd,
		// * unloadEventStart/unloadEventEnd
		// * secureConnectionStart
		// They can be zeroes instead of timestamps.
		// See https://www.w3.org/TR/navigation-timing-2/
		if ( timing.redirectStart ) {
			timingData.redirectCount = performance.navigation.redirectCount;
			timingData.redirecting = timing.redirectEnd - timing.redirectStart;
		} else {
			timingData.redirecting = 0;
		}

		if ( timing.unloadEventStart ) {
			timingData.unload = timing.unloadEventEnd - timing.unloadEventStart;
		} else {
			timingData.unload = 0;
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

	/**
	 * Create the actual NavigationTiming message, and then hand it off to
	 * the EventLogging system to deliver
	 *
	 * @params {string|boolean} oversample Either a string that indicates the reason
	 *     that an oversample was collected, or boolean
	 *     false to indicate that it's not an oversample
	 */
	function emitNavigationTimingWithOversample( oversample ) {
		var event = {
				isHttp2: /H2/.test( $.cookie( 'CP' ) ),
				isHiDPI: getDevicePixelRatio() > 1,
				isAnon: mw.config.get( 'wgUserId' ) === null,
				mediaWikiVersion: mw.config.get( 'wgVersion' ),
				isOversample: oversample !== false
			},
			page = {
				pageId: mw.config.get( 'wgArticleId' ),
				namespaceId: mw.config.get( 'wgNamespaceNumber' ),
				revId: mw.config.get( 'wgCurRevisionId' ),
				action: mw.config.get( 'wgAction' ) // view, submit, etc.
			},
			isSpecialPage = !!mw.config.get( 'wgCanonicalSpecialPageName' ),
			mobileMode = mw.config.get( 'wgMFMode' );

		if ( oversample ) {
			event.oversampleReason = JSON.stringify( oversample );
		}

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

		// If present, collect the effectiveConnectionType from the NetworkInfo API
		// https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
		//
		// This will require some post-processing in order to track usefully
		if ( navigator.connection ) {
			if ( typeof navigator.connection.effectiveType === 'string' ) {
				event.netinfoEffectiveConnectionType = navigator.connection.effectiveType;
			}
		}

		$.extend( event, getNavTiming() );

		if ( navigation && navigation.type === TYPE_NAVIGATE && !isCompliant() ) {
			// Keep track of non-compliant browsers (only on TYPE_NAVIGATE)
			mw.eventLog.logFailure( 'NavigationTiming', 'nonCompliant' );
		}
		mw.eventLog.logEvent( 'NavigationTiming', event );
	}

	/**
	 * Simple wrapper function for readability
	 */
	function emitNavigationTiming() {
		emitNavigationTimingWithOversample( false );
	}

	/**
	 * Emits an event with the time required to save an edit
	 */
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

	/**
	 * Test whether this client is located in a geography that we want to
	 * oversample
	 *
	 * @param {Object} geos Object whose properties are country/region codes to be
	 *                      oversampled
	 * @return {Array} A list of geos that were selected for oversample
	 */
	function testGeoOversamples( geos ) {
		var myGeo, geoOversamples = [];

		// Geo oversample depends on the global Geo, which is created by the
		// CentralNotice extension.  We don't depend on it, though, because
		// it's pretty heavy.
		if ( !window.Geo ) {
			return [];
		}

		myGeo = Geo.country || Geo.country_code;

		if ( myGeo in geos ) {
			if ( inSample( geos[ myGeo ] ) ) {
				geoOversamples.push( myGeo );
			}
		}

		return geoOversamples;
	}

	/**
	 * Test whether this client's user agent is one that we want to oversample
	 *
	 * @param {Object} userAgents Objects whose properties are User Agent strings
	 *                            to be oversampled, with value equal to the
	 *                            sample frequency
	 * @return {Array} An array of User Agent strings that are being oversampled
	 */
	function testUAOversamples( userAgents ) {
		var userAgent, userAgentSamples = [];

		if ( !navigator.userAgent ) {
			return [];
		}

		if ( Object.keys( userAgents ).length === 0 ) {
			return [];
		}

		// Look at each user agent string that's been selected for oversampling,
		// and check whether this client matches.  If it does, do a random to select
		// whether or not to oversample in this case.
		//
		// For example, assume a client with user agent
		//    "Firefox/57.0".
		// If the oversamples are configured as
		//    {'Firefox': 10, 'Firefox/57': 2}
		// then the result will be
		//    5% of the time: ['Firefox', 'Firefox/57']
		//    45% of the time: ['Firefox/57']
		//    5% of the time: ['Firefox']
		//    45% of the time: []
		//
		for ( userAgent in userAgents ) {
			if ( navigator.userAgent.indexOf( userAgent ) >= 0 ) {
				if ( inSample( userAgents[ userAgent ] ) ) {
					userAgentSamples.push( userAgent );
				}
			}
		}

		return userAgentSamples;
	}

	/**
	 *
	 * Main - start of what runs on load
	 *
	 */
	if ( window.performance ) {
		timing = performance.timing;
		navigation = performance.navigation;
	}

	/**
	 * Don't report measurements for pages that have loaded in the background.
	 * Browsers defer or deprioritize loading background pages, causing them to
	 * take longer to load, which throws off our measurements.
	 * See <https://phabricator.wikimedia.org/T146510#2794213> for more details.
	 */
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

	isInSample = inSample( mw.config.get( 'wgNavigationTimingSamplingFactor', 0 ) );
	if ( isInSample ) {
		// Preload NavTiming and SaveTiming schemas
		loadEL = mw.loader.using( [ 'schema.NavigationTiming', 'schema.SaveTiming' ] );
	}

	/**
	 * Called after loadEventEnd by onLoadComplete()
	 */
	function loadCallback() {
		// Get any oversamples, and see whether we match
		oversamples = mw.config.get( 'wgNavigationTimingOversampleFactor' );
		if ( oversamples ) {
			if ( 'geo' in oversamples ) {
				geoOversamples = testGeoOversamples( oversamples.geo );
				if ( geoOversamples.length > 0 ) {
					geoOversamples.forEach( function ( key ) {
						oversampleReasons.push( 'geo:' + key );
					} );
				}
			}

			if ( 'userAgent' in oversamples ) {
				uaOversamples = testUAOversamples( oversamples.userAgent );
				if ( uaOversamples.length > 0 ) {
					uaOversamples.forEach( function ( key ) {
						oversampleReasons.push( 'ua:' + key );
					} );
				}
			}
		}

		// If we're supposed to be sampling this page load (for any reason),
		// then load the NavTiming and SaveTiming schemas
		if ( oversampleReasons.length > 0 && !isInSample ) {
			loadEL = mw.loader.using( [ 'schema.NavigationTiming', 'schema.SaveTiming' ] );
		}

		if ( isInSample && !visibilityChanged ) {
			loadEL.done( emitNavigationTiming );
		}

		if ( oversampleReasons.length > 0 && !visibilityChanged ) {
			loadEL.done( function () {
				emitNavigationTimingWithOversample( oversampleReasons );
			} );
		}

		mw.hook( 'postEdit' ).add( function () {
			mw.loader.using( 'schema.SaveTiming' )
				.done( emitSaveTiming );
		} );
	}

	// Ensure we run after loadEventEnd
	onLoadComplete( loadCallback );

	if ( typeof QUnit !== 'undefined' ) {
		/**
		 * For testing only. Subject to change any time.
		 *
		 * @private
		 */
		module.exports = {
			inSample: inSample,
			emitNavTiming: emitNavigationTiming,
			emitNavigationTimingWithOversample: emitNavigationTimingWithOversample,
			testGeoOversamples: testGeoOversamples,
			testUAOversamples: testUAOversamples,
			loadCallback: loadCallback,
			reinit: function () {
				// performance is recursively read-only and can only be
				// mocked from the top down via window.performance. The test
				// needs to force this module to re-resolve this cached
				// reference. See ext.navigationTiming.test.js
				timing = performance.timing;
				navigation = performance.navigation;

				// For testing loadCallback()
				isInSample = inSample( mw.config.get( 'wgNavigationTimingSamplingFactor', 0 ) );
				if ( isInSample ) {
					loadEL = mw.loader.using( [ 'schema.NavigationTiming', 'schema.SaveTiming' ] );
				}
			}
		};
	}

}( mediaWiki, jQuery ) );
