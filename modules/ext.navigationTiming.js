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
		mediaWikiLoadEnd, surveyDisplayed,
		cpuBenchmarkDone, config = require( './config.json' ),
		collectedPaintEntries = [];

	/**
	 * Get Paint Timing metrics for Schema:NavigationTiming.
	 *
	 * - https://developer.mozilla.org/en-US/docs/Web/API/Performance/getEntriesByType
	 * - https://developer.mozilla.org/en-US/docs/Web/API/PerformancePaintTiming
	 *
	 * @return {Object}
	 */
	function getPaintTiming() {
		var chromeLoadTimes, paintEntries,
			timing = window.performance && performance.timing,
			res = {};

		try {
			paintEntries = performance.getEntriesByType( 'paint' );
		} catch ( e ) {
			// Support: Safari < 11 (getEntriesByType missing)
			paintEntries = [];
		}

		if ( paintEntries.length ) {
			// Support: Chrome 60+, Android 5+
			paintEntries.forEach( function ( entry ) {
				if ( entry.name === 'first-paint' ) {
					res.firstPaint = Math.round( entry.startTime );
				}

				collectedPaintEntries[ entry.name ] = true;
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
	 * PerformanceObserver callback for Paint entries, sending them to EventLogging.
	 */
	function observePaintTiming( list, observer ) {
		var event;

		list.getEntries().forEach( function ( entry ) {
			event = {
				pageviewToken: mw.user.getPageviewToken(),
				name: entry.name,
				startTime: Math.round( entry.startTime )
			};

			mw.eventLog.logEvent( 'PaintTiming', event );

			collectedPaintEntries[ entry.name ] = true;
		} );

		// We've collected all paint entries, stop observing
		if ( collectedPaintEntries[ 'first-paint' ] && collectedPaintEntries[ 'first-contentful-paint' ] ) {
			observer.disconnect();
		}
	}

	/**
	 * Set up PerformanceObserver that will listen to Paint performance events.
	 */
	function setupPaintTimingObserver() {
		var observer;

		if ( !window.PerformanceObserver ) {
			return;
		}

		// No need to observe, both paint events have happened
		if ( collectedPaintEntries[ 'first-paint' ] && collectedPaintEntries[ 'first-contentful-paint' ] ) {
			return;
		}

		observer = new PerformanceObserver( observePaintTiming );

		try {
			observer.observe( { entryTypes: [ 'paint' ] } );
		} catch ( e ) {
			// T217210 Some browsers don't support the "paint" entry type
		}
	}

	/**
	 * Get RumSpeedIndex for Schema:NavigationTiming.
	 *
	 * @return {jQuery.Promise}
	 */
	function emitRUMSpeedIndex() {
		var paintEntries, resourceEntries, ptFirstPaint,
			event = {};

		try {
			paintEntries = performance.getEntriesByType( 'paint' );
			resourceEntries = performance.getEntriesByType( 'resource' );
		} catch ( e ) {
			// Support: Safari < 11 (getEntriesByType missing)
			resourceEntries = [];
			paintEntries = [];
		}

		if ( resourceEntries.length && paintEntries.length ) {
			paintEntries.forEach( function ( entry ) {
				if ( entry.name === 'first-paint' ) {
					ptFirstPaint = Math.round( entry.startTime );
				}
			} );

			if ( ptFirstPaint !== undefined && ptFirstPaint > 0 && ptFirstPaint < 120000 ) {
				event.pageviewToken = mw.user.getPageviewToken();

				return mw.loader.using( 'ext.navigationTiming.rumSpeedIndex' ).then( function () {
					var rumSpeedIndex = require( 'ext.navigationTiming.rumSpeedIndex' );

					event.RSI = Math.round( rumSpeedIndex() );
					mw.eventLog.logEvent( 'RUMSpeedIndex', event );
				} );
			}
		}

		return $.Deferred().resolve();
	}

	/**
	 * Emit ServerTiming events for Server Timing data from the performance timeline
	 *
	 * - https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing
	 * - https://developer.mozilla.org/en-US/docs/Web/API/PerformanceServerTiming
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:ServerTiming
	 */
	function emitServerTiming() {
		var navigationEntry;
		try {
			navigationEntry = performance.getEntriesByType( 'navigation' )[ 0 ];
		} catch ( e ) {
			// Support: Safari < 11 (getEntriesByType missing)
			navigationEntry = false;
		}

		if ( navigationEntry && navigationEntry.serverTiming ) {
			navigationEntry.serverTiming.forEach( function ( serverTimingEntry ) {
				var event = {
					pageviewToken: mw.user.getPageviewToken(),
					description: serverTimingEntry.description,
					name: serverTimingEntry.name,
					duration: serverTimingEntry.duration
				};

				mw.eventLog.logEvent( 'ServerTiming', event );
			} );
		}
	}

	/**
	 * Get Navigation Timing Level 2 metrics for Schema:NavigationTiming.
	 *
	 * As of Navigation Timing Level 2, navigation timing information is also
	 * exposed via the Peformance Timeline, where PerformanceNavigationTiming
	 * extends PerformanceResourceTiming.
	 *
	 * We currently only use this for Resource Timing information about the main
	 * document resource. For the bulk of the Navigation Timing metrics, we use
	 * the Level 1 API, see #getNavTiming().
	 *
	 * - https://www.w3.org/TR/navigation-timing-2/#sec-PerformanceNavigationTiming
	 * - https://www.w3.org/TR/resource-timing-2/#dom-performanceresourcetiming
	 *
	 * @return {Object}
	 */
	function getNavTimingLevel2() {
		var navigationEntry, res = {};
		try {
			navigationEntry = performance.getEntriesByType( 'navigation' )[ 0 ];
		} catch ( e ) {
			// Support: Safari < 11 (getEntriesByType missing)
			navigationEntry = false;
		}

		if ( navigationEntry ) {
			res.transferSize = navigationEntry.transferSize;
		}

		return res;
	}

	/**
	 * Get Navigation Timing Level 1 metrics for Schema:NavigationTiming.
	 *
	 * @return {Object}
	 */
	function getNavTimingLevel1() {
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

		return timingData;
	}

	/**
	 * Run a CPU benchmark inside a Worker (off the main thread) and
	 * emit the CpuBenchmark event afterward.
	 *
	 * This can be called from both showPerformanceSurvey() and onLoadComplete(),
	 * but it will only run the benchmark and emit the event once.
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:CpuBenchmark
	 */
	function emitCpuBenchmark() {
		var blob, worker, work,
			deferred = $.Deferred();

		if ( cpuBenchmarkDone ||
			!window.Blob ||
			!window.URL ||
			!window.URL.createObjectURL ||
			!window.Worker ||
			!window.performance
		) {
			return deferred.resolve();
		}

		cpuBenchmarkDone = true;

		function onMessage() {
			var i,
				startTime,
				amount = 100000000;

			// Global `performance` was originally window-only, and later added to workers.
			// Support: Edge, IE 11, Safari < 11, Mobile Safari < 10.
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

			mw.eventLog.logEvent( 'CpuBenchmark', event );
		} );

		worker.onmessage = function ( e ) {
			deferred.resolve( e.data );
			worker.terminate();
		};

		worker.postMessage( false );

		return deferred;
	}

	/**
	 * Display a performance survey using the QuickSurveys extension
	 * if the extension is present and based on a sub-sampling factor.
	 *
	 * The surveySamplingFactor sampling ratio is
	 * applied after the general NavigationTiming sampling ratio has
	 * been acted on. Meaning it's a percentage of the percentage of
	 * pageviews NavigationTiming is sampled for.
	 *
	 * surveyAuthenticatedSamplingFactor is the same for logged-in users.
	 */
	function showPerformanceSurvey() {
		var isMainPage = mw.config.get( 'wgIsMainPage' ),
			isArticle = mw.config.get( 'wgNamespaceNumber' ) === 0,
			isViewing = mw.config.get( 'wgAction' ) === 'view',
			exists = mw.config.get( 'wgCurRevisionId' ) > 0,
			surveyName = config.surveyName,
			loggedOutSamplingFactor = config.surveySamplingFactor || 0,
			loggedInSamplingFactor = config.surveyAuthenticatedSamplingFactor || 0,
			isInSurveySample;

		// QuickSurveys are only meant to be displayed on articles
		if ( isMainPage || !isArticle || !isViewing || !exists || !surveyName || surveyDisplayed ) {
			return;
		}

		surveyDisplayed = true;

		if ( mw.config.get( 'wgUserId' ) !== null ) {
			isInSurveySample = mw.eventLog.randomTokenMatch( loggedInSamplingFactor || loggedOutSamplingFactor );
		} else {
			isInSurveySample = mw.eventLog.randomTokenMatch( loggedOutSamplingFactor );
		}

		if ( !isInSurveySample ) {
			return;
		}

		mw.loader.using( 'ext.quicksurveys.init' ).then( function () {
			mw.extQuickSurveys.showSurvey( surveyName );
		} );

		// If we're sampled for the survey, run the CPU microbenchmark
		// unconditionally, we might need it for machine learning models.
		emitCpuBenchmark();
	}

	/**
	 * Turn a labelled ResourceTiming entry into a Schema:ResourceTiming event.
	 *
	 * @params {ResourceTiming|PerformanceResourceTiming} resource From the ResourceTiming API
	 * @params {string} label Label for the resource
	 */
	function makeResourceTimingEvent( resource, label ) {
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

			if ( fields.indexOf( key ) !== -1 ) {
				if ( typeof value === 'number' ) {
					event[ key ] = Math.round( value );
				} else {
					event[ key ] = value;
				}
			}
		}

		return event;
	}

	/**
	 * If the current page has images, records the ResourceTiming data of the top image
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:ResourceTiming
	 */
	function emitTopImageResourceTiming() {
		var img,
			resources,
			srcset,
			urls = [];

		if ( !window.performance || !performance.getEntriesByType ) {
			// Support: Safari < 11 (getEntriesByType missing)
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
					// We've found a ResourceTiming entry that corresponds to the top
					// article image, let's emit an EL event with the entry's data
					mw.eventLog.logEvent( 'ResourceTiming', makeResourceTimingEvent( resource, 'top-image' ) );
				}
			} );
		} );
	}

	/**
	 * If the current page displays a CentralNotice banner, records its display time
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:CentralNoticeTiming
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

			mw.eventLog.logEvent( 'CentralNoticeTiming', event );
		}
	}

	/** @return {boolean} */
	function isRegularNavigation() {
		var TYPE_NAVIGATE = 0;

		// Current navigation is TYPE_NAVIGATE (e.g. not TYPE_RELOAD)
		// https://developer.mozilla.org/en-US/docs/Web/API/Performance/navigation
		// performance.navigation is part of Navigation Timing Level 1.
		// Under Navigation Timing Level 2, it is available as a string
		// under PerformanceNavigationTiming#type.
		return window.performance &&
			performance.timing &&
			performance.navigation &&
			performance.navigation.type === TYPE_NAVIGATE;
	}

	/**
	 * Collect the page load performance data and send the NavigationTiming beacon.
	 *
	 * Should not be called unless at least the Navigation Timing Level 1 API is
	 * available and isRegularNavigation() returns true.
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:NavigationTiming
	 * @params {string|boolean} oversample Either a string that indicates the reason
	 *     that an oversample was collected, or boolean
	 *     false to indicate that it's not an oversample
	 */
	function emitNavigationTimingWithOversample( oversample ) {
		var mobileMode,
			event = {};

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
		event.pageviewToken = mw.user.getPageviewToken();
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

			if ( typeof navigator.connection.type === 'string' ) {
				event.netinfoConnectionType = navigator.connection.type;
			}
		}

		if ( navigator.deviceMemory ) {
			event.deviceMemory = navigator.deviceMemory;
		}

		$.extend( event,
			getNavTimingLevel1(),
			getPaintTiming(),
			getNavTimingLevel2()
		);

		// T214977 Deliberatly after getPaintTiming() to ensure that we will only capture
		// paint events that getPaintTiming() did not
		setupPaintTimingObserver();

		mw.eventLog.logEvent( 'NavigationTiming', event );
	}

	/**
	 * Simple wrapper function for readability
	 */
	function emitNavigationTiming() {
		emitNavigationTimingWithOversample( false );
	}

	/**
	 * Emit a SaveTiming event if this was the page load following an edit submission.
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:SaveTiming
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
		var pageNamesSamples = [],
			pageName = mw.config.get( 'wgPageName' );

		// Look at each page name that's been selected for oversampling,
		// and check whether the current page matches.  If it does, do a random to select
		// whether or not to oversample in this case.
		//
		if ( pageName in pageNames ) {
			if ( mw.eventLog.randomTokenMatch( pageNames[ pageName ] ) ) {
				pageNamesSamples.push( pageName );
			}
		}

		return pageNamesSamples;
	}

	/**
	 * Test whether this wiki is one that we want to oversample
	 *
	 * @param {Object} wikis Objects whose properties are wikis
	 *                            to be oversampled, with value equal to the
	 *                            sample frequency
	 * @return {Array} An array of wikis that are being oversampled
	 */
	function testWikiOversamples( wikis ) {
		var wikiSamples = [],
			wiki = mw.config.get( 'wgDBname' );

		// Look at each wiki that's been selected for oversampling,
		// and check whether the current wiki matches.  If it does, do a random to select
		// whether or not to oversample in this case.
		//
		if ( wiki in wikis ) {
			if ( mw.eventLog.randomTokenMatch( wikis[ wiki ] ) ) {
				wikiSamples.push( wiki );
			}
		}

		return wikiSamples;
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
		var oversamples, oversampleReasons, isInSample;

		// Maybe send SaveTiming beacon
		mw.hook( 'postEdit' ).add( emitSaveTiming );

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
		oversamples = config.oversampleFactor;

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

			if ( 'wiki' in oversamples ) {
				testWikiOversamples( oversamples.wiki ).forEach( function ( key ) {
					oversampleReasons.push( 'wiki:' + key );
				} );
			}
		}

		isInSample = mw.eventLog.inSample( config.samplingFactor || 0 );

		if ( !oversampleReasons.length && !isInSample ) {
			// NavTiming: Not sampled
			return;
		}

		if ( isRegularNavigation() ) {
			// These are events separate from NavigationTiming that emit under the
			// same circumstances as navigation timing sampling and oversampling.
			emitCentralNoticeTiming();
			emitTopImageResourceTiming();
			emitServerTiming();
			emitRUMSpeedIndex();

			// Run a CPU microbenchmark for a portion of measurements
			if ( mw.eventLog.randomTokenMatch( config.cpuBenchmarkSamplingFactor || 0 ) ) {
				emitCpuBenchmark();
			}

			if ( isInSample ) {
				emitNavigationTiming();
			}

			if ( oversampleReasons.length ) {
				emitNavigationTimingWithOversample( oversampleReasons );
			}
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
			makeResourceTimingEvent: makeResourceTimingEvent,
			emitServerTiming: emitServerTiming,
			emitTopImageResourceTiming: emitTopImageResourceTiming,
			emitCentralNoticeTiming: emitCentralNoticeTiming,
			testGeoOversamples: testGeoOversamples,
			testUAOversamples: testUAOversamples,
			testPageNameOversamples: testPageNameOversamples,
			testWikiOversamples: testWikiOversamples,
			loadCallback: loadCallback,
			onMwLoadEnd: onMwLoadEnd,
			emitCpuBenchmark: emitCpuBenchmark,
			emitRUMSpeedIndex: emitRUMSpeedIndex,
			reinit: function () {
				// Call manually because, during test execution, actual
				// onLoadComplete will probably not have happened yet.
				setMwLoadEnd();

				// Mock a few things that main() normally does,
				// so that we  can test loadCallback()
				visibilityChanged = false;
			}
		};

		config = {
			samplingFactor: 1,
			oversampleFactor: {
				geo: {
					XX: 1
				}
			}
		};
	}

}() );
