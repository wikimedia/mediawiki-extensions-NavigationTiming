/*!
 * JavaScript module for logging client-side latency measurements.
 * @see https://mediawiki.org/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v2 or later
 * @author Ori Livneh <ori@wikimedia.org>
 */
( function ( mw, $ ) {
	'use strict';

	var mediaWikiLoadEnd, hiddenProp, visibilityEvent,
		isInSample, oversamples,
		oversampleReasons = [],
		loadEL = false,
		visibilityChanged = false,
		TYPE_NAVIGATE = 0,
		preloadedModules = [ 'schema.NavigationTiming', 'schema.SaveTiming', 'ext.navigationTiming.rumSpeedIndex' ];

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
	 * Get paint values
	 */
	function getPaintTiming( navStart, timing ) {
		var paintEntries, resourceEntries,
			ptFirstPaint, chromeLoadTimes, rumSpeedIndex,
			res = {};

		try {
			// getEntriesByType has really hit or miss support:
			// https://developer.mozilla.org/en-US/docs/Web/API/Performance/getEntriesByType
			paintEntries = performance.getEntriesByType( 'paint' );
			resourceEntries = performance.getEntriesByType( 'resource' );
		} catch ( e ) {
			resourceEntries = [];
			paintEntries = [];
		}

		if ( paintEntries.length ) {
			paintEntries.forEach( function ( entry ) {
				if ( entry.name === 'first-paint' ) {
					ptFirstPaint = res.firstPaint = Math.round( entry.startTime );
				}
			} );
		} else if ( timing.msFirstPaint > navStart ) {
			res.firstPaint = timing.msFirstPaint - navStart;
		/* global chrome */
		} else if ( window.chrome && chrome.loadTimes ) {
			chromeLoadTimes = chrome.loadTimes();
			if ( chromeLoadTimes.firstPaintTime > chromeLoadTimes.startLoadTime ) {
				res.firstPaint = Math.round( 1000 *
					( chromeLoadTimes.firstPaintTime - chromeLoadTimes.startLoadTime ) );
			}
		}

		if ( resourceEntries.length && paintEntries.length ) {
			if ( ptFirstPaint === undefined || ptFirstPaint < 0 || ptFirstPaint > 120000 ) {
				res.RSI = 0;
			} else {
				rumSpeedIndex = require( 'ext.navigationTiming.rumSpeedIndex' );
				res.RSI = Math.round( rumSpeedIndex() );
			}
		}

		return res;
	}

	/**
	 * Get Navigation Timing data from the browser
	 *
	 * @return {Object} timingData with normalized fields
	 */
	function getNavTiming() {
		var timing = window.performance && performance.timing,
			navStart = timing && timing.navigationStart,
			timingData = {};

		if ( !timing ) {
			return timingData;
		}

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

		$.extend( timingData, getPaintTiming( navStart, timing ) );

		// We probably have gaps in the navigation timing data so measure them.
		timingData.gaps = timing.domainLookupStart - timing.fetchStart;
		timingData.gaps += timing.connectStart - timing.domainLookupEnd;
		timingData.gaps += timing.requestStart - timing.connectEnd;
		timingData.gaps += timing.loadEventStart - timing.domComplete;

		timingData.stickyRandomSessionId = mw.user.stickyRandomId();

		return timingData;
	}

	/** Display a performance survey using the QuickSurveys extension
	 * if the extension is present and based on a sub-sampling factor.
	 *
	 * The wgNavigationTimingSurveySamplingFactor sampling ratio is
	 * applied after the general NavigationTiming sampling ratio has
	 * been acted on. Meaning it's a percentage of the percentage of
	 * pageviews NavigationTiming is sampled for.
	 */
	function showPerformanceSurvey() {
		var isMainPage = mw.config.get( 'wgIsMainPage' ),
			isArticle = mw.config.get( 'wgIsArticle' ),
			surveyName = mw.config.get( 'wgNavigationTimingSurveyName' );

		// QuickSurveys are only meant to be displayed on articles
		if ( isMainPage || !isArticle || !surveyName ) {
			return;
		}

		isInSample = inSample( mw.config.get( 'wgNavigationTimingSurveySamplingFactor', 0 ) );

		if ( !isInSample ) {
			return;
		}

		mw.loader.using( 'ext.quicksurveys.init' ).then( function () {
			mw.extQuickSurveys.showSurvey( surveyName );
		} );
	}

	/**
	 * Collect the actual event data and send the EventLogging beacon
	 *
	 * @params {string|boolean} oversample Either a string that indicates the reason
	 *     that an oversample was collected, or boolean
	 *     false to indicate that it's not an oversample
	 */
	function emitNavigationTimingWithOversample( oversample ) {
		var event = {},
			mobileMode = mw.config.get( 'wgMFMode' );

		// Minimal requirements:
		// - W3C Navigation Timing Level 1 (performance.timing && performance.navigation)
		// - Current navigation is TYPE_NAVIGATE (e.g. not TYPE_RELOAD)
		if ( !window.performance ||
			!performance.timing ||
			!performance.navigation ||
			performance.navigation.type !== TYPE_NAVIGATE
		) {
			// Don't send a beacon.
			return;
		}

		// Properties: MediaWiki
		//
		// Custom properties from MediaWiki.
		event.mediaWikiVersion = mw.config.get( 'wgVersion' );
		event.isAnon = mw.config.get( 'wgUserId' ) === null;
		if ( mw.config.get( 'wgCanonicalSpecialPageName' ) ) {
			// Omit page information for special pages,
			// these don't have IDs, revisions or actions.
			event.mwSpecialPageName = mw.config.get( 'wgCanonicalSpecialPageName' );
		} else {
			event.namespaceId = mw.config.get( 'wgNamespaceNumber' );
			event.revId = mw.config.get( 'wgCurRevisionId' );
			// e.g. "view", "edit", "history", etc.
			event.action = mw.config.get( 'wgAction' );
		}
		if ( typeof mobileMode === 'string' && mobileMode.indexOf( 'desktop' ) === -1 ) {
			// e.g. "stable" or "beta"
			event.mobileMode = mobileMode;
		}
		if ( mediaWikiLoadEnd ) {
			event.mediaWikiLoadEnd = mediaWikiLoadEnd;
		}
		if ( window.Geo ) {
			/* global Geo */
			if ( typeof Geo.country === 'string' ) {
				event.originCountry = Geo.country;
			}
		}

		// Properties: meta
		event.isOversample = oversample !== false;
		if ( oversample ) {
			event.oversampleReason = JSON.stringify( oversample );
		}

		// Properties: NetworkInfo API
		//
		// If present, collect the effectiveConnectionType from the NetworkInfo API
		// https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
		//
		// This will require some post-processing in order to track usefully
		if ( navigator.connection ) {
			if ( typeof navigator.connection.effectiveType === 'string' ) {
				event.netinfoEffectiveConnectionType = navigator.connection.effectiveType;
			}
		}

		// Properties: Navigation Timing API
		$.extend( event, getNavTiming() );

		mw.eventLog.logEvent( 'NavigationTiming', event ).done( showPerformanceSurvey );
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
		var timing = window.performance && performance.timing,
			responseStart;

		if ( !mw.config.get( 'wgPostEdit' ) || !timing ) {
			return;
		}

		responseStart = timing.responseStart - timing.navigationStart;

		if ( !responseStart ) {
			return;
		}

		mw.eventLog.logEvent( 'SaveTiming', {
			mediaWikiVersion: mw.config.get( 'wgVersion' ),
			saveTiming: responseStart
		} );
	}

	/**
	 * Set the local mediaWikiLoadEnd variable
	 */
	function setMwLoadEnd() {
		if ( window.performance && performance.now ) {
			// Record this now, for later use by emitNavigationTiming
			mediaWikiLoadEnd = Math.round( performance.now() );
		}
	}

	/**
	 * Run a callback currently loading ResourceLoader modules have settled.
	 * @return {jQuery.Deferred}
	 */
	function onMwLoadEnd() {
		// Get a list of modules currently in loading state
		var modules = mw.loader.getModuleNames().filter( function ( module ) {
			return mw.loader.getState( module ) === 'loading';
		} );
		// Wait for them to complete loading (regardles of failures). First, try a single
		// mw.loader.using() call. That's efficient, but has the drawback of being rejected
		// upon first failure. Fall back to tracking each module separately. We usually avoid
		// that because of high overhead for that internally to mw.loader.
		return mw.loader.using( modules ).catch( function () {
			return $.Deferred( function ( deferred ) {
				var i, count = modules.length;
				function decrement() {
					count--;
					if ( count === 0 ) {
						deferred.resolve();
					}
				}
				for ( i = 0; i < modules.length; i++ ) {
					mw.loader.using( modules[ i ] ).always( decrement );
				}
			} );
		} );
	}

	function onLoadComplete( callback ) {
		onMwLoadEnd().then( function () {
			setMwLoadEnd();

			// Defer one tick for loadEventEnd to get set.
			if ( document.readyState === 'complete' ) {
				setTimeout( callback );
			} else {
				window.addEventListener( 'load', function () {
					setTimeout( callback );
				} );
			}
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
			return geoOversamples;
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
			return userAgentSamples;
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

	// Make the main isInSample decision now so that we can start
	// lazy-loading as early as possible.
	// Oversampling is decided later because it depends on Geo,
	// which may not've been set yet.
	isInSample = inSample( mw.config.get( 'wgNavigationTimingSamplingFactor', 0 ) );
	if ( isInSample ) {
		loadEL = mw.loader.using( preloadedModules );
	}

	/**
	 * Called after loadEventEnd by onLoadComplete()
	 */
	function loadCallback() {
		// Maybe send SaveTiming beacon
		mw.hook( 'postEdit' ).add( function () {
			mw.loader.using( 'schema.SaveTiming' )
				.done( emitSaveTiming );
		} );

		// Decide whether to send NavTiming beacon
		if ( visibilityChanged ) {
			// NavTiming: Ignore background tabs
			return;
		}

		// Get any oversamples, and see whether we match
		oversamples = mw.config.get( 'wgNavigationTimingOversampleFactor' );
		if ( oversamples ) {
			if ( 'geo' in oversamples ) {
				testGeoOversamples( oversamples.geo ).forEach( function ( key ) {
					oversampleReasons.push( 'geo:' + key );
				} );
			}

			if ( 'userAgent' in oversamples ) {
				testUAOversamples( oversamples.userAgent ).forEach( function ( key ) {
					oversampleReasons.push( 'ua:' + key );
				} );
			}
		}

		if ( !oversampleReasons.length && !isInSample ) {
			// NavTiming: Not sampled
			return;
		}

		if ( !loadEL ) {
			// Start lazy-loading modules if we haven't already.
			loadEL = mw.loader.using( preloadedModules );
		}

		if ( isInSample ) {
			loadEL.done( emitNavigationTiming );
		}

		if ( oversampleReasons.length ) {
			loadEL.done( function () {
				emitNavigationTimingWithOversample( oversampleReasons );
			} );
		}
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
			onMwLoadEnd: onMwLoadEnd,
			reinit: function () {
				// Call manually because, during test execution, actual
				// onLoadComplete will probably not have happened yet.
				setMwLoadEnd();

				// For testing loadCallback()
				isInSample = inSample( mw.config.get( 'wgNavigationTimingSamplingFactor', 0 ) );
				if ( !loadEL ) {
					loadEL = mw.loader.using( preloadedModules );
				}
			}
		};
	}

}( mediaWiki, jQuery ) );
