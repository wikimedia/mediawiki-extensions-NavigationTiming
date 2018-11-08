/*!
 * JavaScript module for logging client-side latency measurements.
 * @see https://mediawiki.org/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v2 or later
 * @author Ori Livneh <ori@wikimedia.org>
 */
( function () {
	'use strict';

	var visibilityEvent, visibilityChanged,
		isInSample, preloadedModules, loadEL,
		mediaWikiLoadEnd, surveyDisplayed;

	/**
	 * Get First Paint
	 */
	function getFirstPaint() {
		var chromeLoadTimes, paintEntries,
			timing = window.performance && performance.timing,
			res = {};

		try {
			// getEntriesByType has really hit or miss support:
			// - https://developer.mozilla.org/en-US/docs/Web/API/Performance/getEntriesByType
			// - https://developer.mozilla.org/en-US/docs/Web/API/PerformancePaintTiming
			paintEntries = performance.getEntriesByType( 'paint' );
		} catch ( e ) {
			paintEntries = [];
		}

		if ( paintEntries.length ) {
			// Support: Chrome 60+, Android 5+
			paintEntries.forEach( function ( entry ) {
				if ( entry.name === 'first-paint' ) {
					res.firstPaint = Math.round( entry.startTime );
				}
			} );
		} else if ( timing && timing.msFirstPaint > timing.navigationStart ) {
			// Support: IE9+, Microsoft Edge
			res.firstPaint = timing.msFirstPaint - timing.navigationStart;
		/* global chrome */
		} else if ( window.chrome && chrome.loadTimes ) {
			// Support: Chrome 64 and earlier
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

	/**
	 * Runs a CPU benchmark inside a Worker, off the main thread
	 */
	function runCpuBenchmark() {
		var blob, worker, work,
			deferred = $.Deferred();

		if ( !window.Blob || !window.URL || !window.URL.createObjectURL || !window.Worker || !window.performance ) {
			return deferred.resolve();
		}

		function onMessage() {
			var i,
				startTime,
				amount = 100000000;

			// IE11 doesn't have window.performance exposed inside workers
			if ( !self.performance ) {
				postMessage( false );
				return;
			}

			startTime = performance.now();

			for ( i = amount; i > 0; i-- ) {
				// empty
			}

			postMessage( Math.round( performance.now() - startTime ) );
		}

		work = 'onmessage = ' + String( onMessage );

		blob = new Blob( [ work ], { type: 'application/javascript' } );
		worker = new Worker( URL.createObjectURL( blob ) );

		deferred.then( function ( result ) {
			var event;

			if ( !result ) {
				return;
			}

			event = {
				pageviewToken: mw.user.getPageviewToken(),
				score: result
			};

			mw.loader.using( 'schema.CpuBenchmark' ).then( function () {
				mw.eventLog.logEvent( 'CpuBenchmark', event );
			} );
		} );

		worker.onmessage = function ( e ) {
			deferred.resolve( e.data );
			worker.terminate();
		};

		worker.postMessage( false );

		return deferred;
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
		if ( isMainPage || !isArticle || !isViewing || !exists || !surveyName || surveyDisplayed ) {
			return;
		}

		surveyDisplayed = true;

		isInSurveySample = mw.eventLog.randomTokenMatch( mw.config.get( 'wgNavigationTimingSurveySamplingFactor', 0 ) );

		if ( !isInSurveySample ) {
			return;
		}

		mw.loader.using( 'ext.quicksurveys.init' ).then( function () {
			mw.extQuickSurveys.showSurvey( surveyName );
		} );

		// If we're sampled for the survey, run a CPU microbenchmark
		// We might end up recording that for all RUM measurements if it
		// proves useful, but for now let's only waste CPU cycles for
		// survey samples.
		runCpuBenchmark();
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

		event = {
			pageviewToken: mw.user.getPageviewToken(),
			label: label
		};

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

		return mw.eventLog.logEvent( 'ResourceTiming', event );
	}

	/**
	 * If the current page has images, records the ResourceTiming data of the top image
	 */
	function emitTopImageResourceTiming() {
		var img,
			resources,
			srcset,
			urls = [];

		if ( !window.performance || !performance.getEntriesByType ) {
			return;
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
			return;
		}

		urls.push( img.src );

		if ( img.srcset ) {
			srcset = img.srcset;

			srcset.split( ',' ).forEach( function ( src ) {
				var url = src.trim().split( ' ' )[ 0 ];

				if ( url ) {
					urls.push( url );
				}
			} );
		}

		resources.forEach( function ( resource ) {
			if ( resource.initiatorType !== 'img' ) {
				return;
			}

			urls.forEach( function ( url ) {
				var resourceUri, uri;

				resourceUri = resource.name.substr( resource.name.indexOf( '//' ) );
				uri = url.substr( url.indexOf( '//' ) );

				if ( resourceUri === uri ) {
					mw.loader.using( 'schema.ResourceTiming' ).then( function () {
						/* We've found a ResourceTiming entry that corresponds to the top
						article image, let's emit an EL event with the entry's data */
						emitResourceTiming( resource, 'top-image' );
					} );
				}
			} );
		} );
	}

	/**
	 * If the current page displays a CentralNotice banner, records its display time
	 */
	function emitCentralNoticeTiming( existingObserver ) {
		var event, mark, marks, observer;

		if ( !window.performance || !performance.getEntriesByName ) {
			return;
		}

		marks = performance.getEntriesByName( 'mwCentralNoticeBanner', 'mark' );

		if ( !marks || !marks.length ) {
			if ( !window.PerformanceObserver ) {
				return;
			}

			// Already observing marks
			if ( existingObserver ) {
				return;
			}

			observer = new PerformanceObserver( function () {
				emitCentralNoticeTiming( observer );
			} );

			observer.observe( { entryTypes: [ 'mark' ] } );

			return;
		} else {
			if ( existingObserver ) {
				existingObserver.disconnect();
			}

			mark = marks[ 0 ];

			event = {
				pageviewToken: mw.user.getPageviewToken(),
				time: Math.round( mark.startTime )
			};

			mw.loader.using( 'schema.CentralNoticeTiming' ).then( function () {
				mw.eventLog.logEvent( 'CentralNoticeTiming', event );
			} );
		}
	}

	/**
	 * Collect the actual event data and send the EventLogging beacon
	 *
	 * @params {string|boolean} oversample Either a string that indicates the reason
	 *     that an oversample was collected, or boolean
	 *     false to indicate that it's not an oversample
	 */
	function emitNavigationTimingWithOversample( oversample ) {
		var mobileMode,
			TYPE_NAVIGATE = 0,
			event = {};

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

		// No need to wait for the RUM metrics to be recorded before showing the survey
		showPerformanceSurvey();

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
		mobileMode = mw.config.get( 'wgMFMode' );
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

		if ( navigator.deviceMemory ) {
			event.deviceMemory = navigator.deviceMemory;
		}

		emitCentralNoticeTiming();
		emitTopImageResourceTiming();

		$.extend( event,
			// Properties: Navigation Timing API
			getNavTiming(),
			// Properties: Paint Timing API
			getFirstPaint(),
			getRumSpeedIndex(),
			getLevel2Metrics()
		);

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
			if ( mw.eventLog.randomTokenMatch( geos[ myGeo ] ) ) {
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
				if ( mw.eventLog.randomTokenMatch( userAgents[ userAgent ] ) ) {
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
				if ( mw.eventLog.randomTokenMatch( pageNames[ pageName ] ) ) {
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
	 * Called after loadEventEnd by onLoadComplete()
	 */
	function loadCallback() {
		var oversamples, oversampleReasons;
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
			//
			// Don't report measurements for pages that have loaded in the background.
			// Browsers defer or deprioritize loading background pages, causing them to
			// take longer to load, which throws off our measurements.
			// See <https://phabricator.wikimedia.org/T146510#2794213> for more details.
			return;
		}

		// Get any oversamples, and see whether we match
		oversamples = mw.config.get( 'wgNavigationTimingOversampleFactor' );
		oversampleReasons = [];
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

	/**
	 * Main entry point.
	 * This is called immediately when this file is executed,
	 * typically *before* the page has finished loading.
	 */
	function main() {
		// Collect whether document was hidden at least once during the
		// page loading process. Used by loadCallback().
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
		} else {
			visibilityChanged = false;
		}
		if ( !visibilityChanged ) {
			$( document ).one( visibilityEvent, setVisibilityChanged );
		}

		// Make the main isInSample decision now so that we can start
		// lazy-loading as early as possible.
		// Oversampling is decided later because it depends on Geo,
		// which may not've been set yet.
		isInSample = mw.eventLog.inSample( mw.config.get( 'wgNavigationTimingSamplingFactor', 0 ) );
		preloadedModules = [
			'schema.NavigationTiming',
			'schema.SaveTiming',
			'schema.ResourceTiming',
			'ext.navigationTiming.rumSpeedIndex'
		];
		if ( isInSample ) {
			loadEL = mw.loader.using( preloadedModules );
		}

		// Do the rest after loadEventEnd
		onLoadComplete( loadCallback );
	}

	main();

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
			emitCentralNoticeTiming: emitCentralNoticeTiming,
			testGeoOversamples: testGeoOversamples,
			testUAOversamples: testUAOversamples,
			testPageNameOversamples: testPageNameOversamples,
			loadCallback: loadCallback,
			onMwLoadEnd: onMwLoadEnd,
			runCpuBenchmark: runCpuBenchmark,
			reinit: function () {
				// Call manually because, during test execution, actual
				// onLoadComplete will probably not have happened yet.
				setMwLoadEnd();

				// Mock a few things that main() normally does,
				// so that we  can test loadCallback()
				visibilityChanged = false;
				isInSample = mw.eventLog.inSample( mw.config.get( 'wgNavigationTimingSamplingFactor', 0 ) );
				loadEL = mw.loader.using( preloadedModules );
			}
		};
	}

}() );
