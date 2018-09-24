/*!
 * JavaScript module for logging client-side latency measurements.
 * @see https://mediawiki.org/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v2 or later
 * @author Ori Livneh <ori@wikimedia.org>
 */
( function () {
	'use strict';

	var mediaWikiLoadEnd, visibilityEvent,
		isInSample, oversamples,
		oversampleReasons = [],
		loadEL = false,
		visibilityChanged = false,
		TYPE_NAVIGATE = 0,
		preloadedModules = [ 'schema.NavigationTiming', 'schema.SaveTiming', 'schema.ResourceTiming', 'ext.navigationTiming.rumSpeedIndex' ];

	/**
	 * Get First Paint
	 */
	function getFirstPaint() {
		var chromeLoadTimes, paintEntries,
			timing = window.performance && performance.timing,
			res = {};

		try {
			// getEntriesByType has really hit or miss support:
			// https://developer.mozilla.org/en-US/docs/Web/API/Performance/getEntriesByType
			paintEntries = performance.getEntriesByType( 'paint' );
		} catch ( e ) {
			paintEntries = [];
		}

		if ( paintEntries.length ) {
			paintEntries.forEach( function ( entry ) {
				if ( entry.name === 'first-paint' ) {
					res.firstPaint = Math.round( entry.startTime );
				}
			} );
		} else if ( timing && timing.msFirstPaint > timing.navigationStart ) {
			res.firstPaint = timing.msFirstPaint - timing.navigationStart;
		/* global chrome */
		} else if ( window.chrome && chrome.loadTimes ) {
			chromeLoadTimes = chrome.loadTimes();
			if ( chromeLoadTimes.firstPaintTime > chromeLoadTimes.startLoadTime ) {
				res.firstPaint = Math.round( 1000 *
					( chromeLoadTimes.firstPaintTime - chromeLoadTimes.startLoadTime ) );
			}
		}

		return res;
	}

	/**
	 * Get RumSpeedIndex
	 */
	function getRumSpeedIndex() {
		var paintEntries, resourceEntries, ptFirstPaint, rumSpeedIndex,
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

		if ( resourceEntries.length && paintEntries.length ) {
			paintEntries.forEach( function ( entry ) {
				if ( entry.name === 'first-paint' ) {
					ptFirstPaint = Math.round( entry.startTime );
				}
			} );

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
	 * Get Navigation Timing Level 2 metrics
	 */
	function getLevel2Metrics() {
		var navigationEntry, res = {};

		try {
			// getEntriesByType has really hit or miss support:
			// https://developer.mozilla.org/en-US/docs/Web/API/Performance/getEntriesByType
			navigationEntry = performance.getEntriesByType( 'navigation' )[ 0 ];
		} catch ( e ) {
			navigationEntry = false;
		}

		if ( navigationEntry ) {
			res.transferSize = navigationEntry.transferSize;
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

		// We probably have gaps in the navigation timing data so measure them.
		timingData.gaps = timing.domainLookupStart - timing.fetchStart;
		timingData.gaps += timing.connectStart - timing.domainLookupEnd;
		timingData.gaps += timing.requestStart - timing.connectEnd;
		timingData.gaps += timing.loadEventStart - timing.domComplete;

		timingData.pageviewToken = mw.user.getPageviewToken();

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
			isArticle = mw.config.get( 'wgNamespaceNumber' ) === 0,
			isViewing = mw.config.get( 'wgAction' ) === 'view',
			exists = mw.config.get( 'wgCurRevisionId' ) > 0,
			surveyName = mw.config.get( 'wgNavigationTimingSurveyName' ),
			isInSurveySample;

		// QuickSurveys are only meant to be displayed on articles
		if ( isMainPage || !isArticle || !isViewing || !exists || !surveyName ) {
			return;
		}

		isInSurveySample = mw.eventLog.inSample( mw.config.get( 'wgNavigationTimingSurveySamplingFactor', 0 ) );

		if ( !isInSurveySample ) {
			return;
		}

		mw.loader.using( 'ext.quicksurveys.init' ).then( function () {
			mw.extQuickSurveys.showSurvey( surveyName );
		} );
	}

	/**
	 * Sends a labelled ResourceTiming entry to EventLogging
	 *
	 * @params {ResourceTiming|PerformanceResourceTiming} resource Resource coming from the ResourceTiming API
	 * @params {string} label Label for the resource
	 */
	function emitResourceTiming( resource, label ) {
		var event, key, value,
			fields = [
				'startTime',
				'workerStart',
				'redirectStart',
				'redirectEnd',
				'fetchStart',
				'domainLookupStart',
				'domainLookupEnd',
				'connectStart',
				'secureConnectionStart',
				'connectEnd',
				'requestStart',
				'responseStart',
				'responseEnd',
				'encodedBodySize',
				'decodedBodySize',
				'initiatorType',
				'duration',
				'name',
				'nextHopProtocol',
				'transferSize'
			];

		event = { pageviewToken: mw.user.getPageviewToken(), label: label };

		for ( key in resource ) {
			value = resource[ key ];

			if ( fields.includes( key ) ) {
				if ( typeof value === 'number' ) {
					event[ key ] = Math.round( value );
				} else {
					event[ key ] = value;
				}
			}
		}

		mw.eventLog.logEvent( 'ResourceTiming', event );
	}

	/**
	 * If the current page has images, records the ResourceTiming data of the top image
	 */
	function emitTopImageResourceTiming() {
		var img,
			resources,
			srcset,
			urls = [],
			promise = $.Deferred().resolve();

		if ( !window.performance || !performance.getEntriesByType ) {
			return promise;
		}

		resources = performance.getEntriesByType( 'resource' );

		/* We pick the first reasonably large image inside the article body.
		It's commonplace for infoboxes to contain small icons that can sometimes
		precede the first meaningful image in the DOM (eg. the portrait for a person).
		100 x 100 is a somewhat arbitrary choice, but it should be large enough
		to avoid small icons. */
		img = $( '.mw-parser-output img' ).filter( function ( idx, e ) {
			return e.width * e.height > 100 * 100;
		} )[ 0 ];

		if ( !resources || !img ) {
			return promise;
		}

		urls.push( img.src );
		srcset = img.srcset;

		srcset.split( ',' ).forEach( function ( src ) {
			var url = src.trim().split( ' ' )[ 0 ];

			if ( url ) {
				urls.push( url );
			}
		} );

		resources.forEach( function ( resource ) {
			if ( resource.initiatorType !== 'img' ) {
				return promise;
			}

			urls.forEach( function ( url ) {
				var resourcUri, uri;

				resourcUri = resource.name.substr( resource.name.indexOf( '//' ) );
				uri = url.substr( url.indexOf( '//' ) );

				if ( resourcUri === uri ) {
					mw.loader.using( 'schema.ResourceTiming' ).then( function () {
						/* We've found a ResourceTiming entry that corresponds to the top
						article image, let's emit an EL event with the entry's data */
						promise = emitResourceTiming( resource, 'top-image' );
					} );
				}
			} );
		} );

		return promise;
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

		emitTopImageResourceTiming();

		$.extend( event,
			// Properties: Navigation Timing API
			getNavTiming(),
			// Properties: Paint Timing API
			getFirstPaint(),
			getRumSpeedIndex(),
			getLevel2Metrics()
		);

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
		var deferred = $.Deferred(),
			modules = window.RLPAGEMODULES;

		if ( !modules ) {
			// Fallback for parser cache from 1.32.0-wmf.20 and earlier
			mw.log.warn( 'Fallback RLPAGEMODULES' );
			modules = mw.loader.getModuleNames().filter( function ( module ) {
				return mw.loader.getState( module ) === 'loading';
			} );
		}

		// Wait for them to complete loading (regardless of failures). First, try a single
		// mw.loader.using() call. That's efficient, but has the drawback of being rejected
		// upon first failure. Fall back to tracking each module separately. We usually avoid
		// that because of high overhead for that internally to mw.loader.
		mw.loader.using( modules ).done( function () {
			// Use done() and fail() instead of then() because then() is async.
			// setMwLoadEnd() should happen in the same tick as when the modules
			// become ready. Using then() would execute it after jQuery's setTimeout,
			// which could skew the metric by a lot as it would be delayed until:
			// - after the current mw.loader#doPropagate batch and execution of other
			//   lazy-loaded modules that may now be unblocked.
			// - after any other promise callbacks queued so far.
			// - after the >4ms clamping of setTimeout.
			// - after other timers queued so far with a low timeout.
			// - after whatever other non-js tasks the browser decides to do before
			//   its attention back to the JS event loop.
			setMwLoadEnd();
			deferred.resolve();
		} ).fail( function () {
			var i, count = modules.length;
			function decrement() {
				count--;
				if ( count === 0 ) {
					setMwLoadEnd();
					deferred.resolve();
				}
			}
			for ( i = 0; i < modules.length; i++ ) {
				mw.loader.using( modules[ i ] ).always( decrement );
			}
		} );
		return deferred;
	}

	function onLoadComplete( callback ) {
		onMwLoadEnd().then( function () {
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
			if ( mw.eventLog.inSample( geos[ myGeo ] ) ) {
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
				if ( mw.eventLog.inSample( userAgents[ userAgent ] ) ) {
					userAgentSamples.push( userAgent );
				}
			}
		}

		return userAgentSamples;
	}

	/**
	 * Test whether this page name is one that we want to oversample
	 *
	 * @param {Object} pageNames Objects whose properties are page names
	 *                            to be oversampled, with value equal to the
	 *                            sample frequency
	 * @return {Array} An array of page names that are being oversampled
	 */
	function testPageNameOversamples( pageNames ) {
		var pageName,
			pageNamesSamples = [],
			currentPageName = mw.config.get( 'wgPageName' );

		// Look at each page name that's been selected for oversampling,
		// and check whether the current page matches.  If it does, do a random to select
		// whether or not to oversample in this case.
		//
		for ( pageName in pageNames ) {
			if ( currentPageName === pageName ) {
				if ( mw.eventLog.inSample( pageNames[ pageName ] ) ) {
					pageNamesSamples.push( pageName );
				}
			}
		}

		return pageNamesSamples;
	}

	/**
	 * Handle 'visibilitychange' event.
	 */
	function setVisibilityChanged() {
		visibilityChanged = true;
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
		visibilityChanged = document.hidden;
		visibilityEvent = 'visibilitychange';
	} else if ( typeof document.mozHidden !== 'undefined' ) {
		visibilityChanged = document.mozHidden;
		visibilityEvent = 'mozvisibilitychange';
	} else if ( typeof document.msHidden !== 'undefined' ) {
		visibilityChanged = document.msHidden;
		visibilityEvent = 'msvisibilitychange';
	} else if ( typeof document.webkitHidden !== 'undefined' ) {
		visibilityChanged = document.webkitHidden;
		visibilityEvent = 'webkitvisibilitychange';
	}
	if ( !visibilityChanged ) {
		$( document ).one( visibilityEvent, setVisibilityChanged );
	}

	// Make the main isInSample decision now so that we can start
	// lazy-loading as early as possible.
	// Oversampling is decided later because it depends on Geo,
	// which may not've been set yet.
	isInSample = mw.eventLog.inSample( mw.config.get( 'wgNavigationTimingSamplingFactor', 0 ) );
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

		// Stop listening for 'visibilitychange' events
		$( document ).off( visibilityEvent, setVisibilityChanged );

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

			if ( 'pageName' in oversamples ) {
				testPageNameOversamples( oversamples.pageName ).forEach( function ( key ) {
					oversampleReasons.push( 'pagename:' + key );
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
			emitNavTiming: emitNavigationTiming,
			emitNavigationTimingWithOversample: emitNavigationTimingWithOversample,
			emitResourceTiming: emitResourceTiming,
			emitTopImageResourceTiming: emitTopImageResourceTiming,
			testGeoOversamples: testGeoOversamples,
			testUAOversamples: testUAOversamples,
			testPageNameOversamples: testPageNameOversamples,
			loadCallback: loadCallback,
			onMwLoadEnd: onMwLoadEnd,
			reinit: function () {
				// Call manually because, during test execution, actual
				// onLoadComplete will probably not have happened yet.
				setMwLoadEnd();

				// For testing loadCallback()
				visibilityChanged = false;
				isInSample = mw.eventLog.inSample( mw.config.get( 'wgNavigationTimingSamplingFactor', 0 ) );
				loadEL = mw.loader.using( preloadedModules );
			}
		};
	}

}() );
