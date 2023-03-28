/*!
 * JavaScript module for logging client-side latency measurements.
 * @see https://mediawiki.org/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v2 or later
 * @author Ori Livneh <ori@wikimedia.org>
 */
( function () {
	'use strict';

	var perf = window.performance;
	var navigator = window.navigator;
	var Geo = window.Geo;

	var config = require( './config.json' );
	var policyViolationEmitted = 0;
	var visibilityChanged = false;

	var mediaWikiLoadEnd;
	var surveyDisplayed;
	var cpuBenchmarkDone;

	/**
	 * Creates an event object populated containing essential request context information.
	 * These context fields are consumed by get_navigation_timing_context() in the navtiming daemon
	 * and allow us to explore the data by facet in Prometheus/Grafana.
	 *
	 * The populated fields are:
	 * - pageviewToken: unique token for the pageview to cross-reference the request between schemas
	 * - isAnon: is the user anonymous or authenticated?
	 * - isOversample: is the request an oversampled measurement?
	 * - oversampleReason: why was the request oversampled if it was?
	 * - mobileMode: which mobile mode is the website in?
	 * - originCountry: based on IP address, which country was the request made from?
	 *
	 * @param {Array} oversampleReasons List of zero or more oversample reason strings
	 * @return {Object}
	 */
	function makeEventWithRequestContext( oversampleReasons ) {
		var event = {};
		event.pageviewToken = mw.user.getPageviewToken();
		event.isAnon = mw.config.get( 'wgUserId' ) === null;
		event.isOversample = oversampleReasons.length > 0;

		if ( oversampleReasons.length ) {
			event.oversampleReason = JSON.stringify( oversampleReasons );
		}

		var mobileMode = mw.config.get( 'wgMFMode' );

		if ( typeof mobileMode === 'string' && mobileMode.indexOf( 'desktop' ) === -1 ) {
			// e.g. "stable" or "beta"
			event.mobileMode = mobileMode;
		}

		if ( Geo && typeof Geo.country === 'string' ) {
			event.originCountry = Geo.country;
		}

		return event;
	}

	/**
	 * Get Navigation Timing Level 1 metrics for Schema:NavigationTiming.
	 *
	 * @return {Object}
	 */
	function getNavTimingLevel1() {
		var timing = perf && perf.timing;
		var navStart = timing && timing.navigationStart;

		var timingData = {};

		if ( !timing ) {
			return timingData;
		}

		[
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
		].forEach( function ( marker ) {
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
	 * Get Cumulative LayoutShift score.
	 *
	 * @return {number}
	 */
	function getCumulativeLayoutShift() {
		// eslint-disable-next-line compat/compat -- Checked by caller
		var perfObserver = new PerformanceObserver( function () {} );

		// See https://github.com/mmocny/web-vitals/wiki/Snippets-for-LSN-using-PerformanceObserver#max-session-gap1s-limit5s
		// https://github.com/GoogleChrome/web-vitals/blob/v3.1.0/src/onCLS.ts
		perfObserver.observe( { type: 'layout-shift', buffered: true } );
		var entries = perfObserver.takeRecords();
		var max = 0;
		var curr = 0;
		var firstTs = Number.NEGATIVE_INFINITY;
		var prevTs = Number.NEGATIVE_INFINITY;
		entries.forEach( function ( entry ) {
			if ( entry.hadRecentInput ) {
				return;
			}
			if ( entry.startTime - firstTs > 5000 || entry.startTime - prevTs > 1000 ) {
				firstTs = entry.startTime;
				curr = 0;
			}
			prevTs = entry.startTime;
			curr += entry.value;
			max = Math.max( max, curr );
		} );
		perfObserver.disconnect();
		// 0.25 is poor CLS, below 0.1 is good we don't
		// really care about low values
		return max > 0.01 ? Number( max.toFixed( 3 ) ) : 0;
	}

	/**
	 * Get the largest contentful paint (LCP).
	 *
	 * @return {{value: number, element: string}}  When the largest element was painted.
	 */
	function getLargestContentfulPaint() {
		// eslint-disable-next-line compat/compat -- PerformanceObserver checked
		var element, value, perfObserver = new PerformanceObserver( function () {
		} );
		// See https://github.com/GoogleChrome/web-vitals/blob/v3.1.0/src/onLCP.ts
		perfObserver.observe( { type: 'largest-contentful-paint', buffered: true } );
		var entries = perfObserver.takeRecords();
		if ( entries.length > 0 ) {
			// https://github.com/w3c/largest-contentful-paint
			var largestEntry = entries[ entries.length - 1 ];
			value = Number( Math.max( largestEntry.renderTime, largestEntry.loadTime ).toFixed( 0 )
			);
			element = largestEntry.element ? largestEntry.element.tagName : undefined;
		}
		perfObserver.disconnect();
		return { value: value, element: element };
	}

	function getLongTask() {
		// eslint-disable-next-line compat/compat -- PerformanceObserver checked
		var totalEntries, totalDuration, perfObserver = new PerformanceObserver( function () {
		} );
		// https://github.com/w3c/longtasks/blob/6d0a5dff7f20083cff74f057822920fd7c731cef/README.md
		perfObserver.observe( { type: 'longtask', buffered: true } );
		var entries = perfObserver.takeRecords();
		totalDuration = 0;
		totalEntries = entries.length;
		entries.forEach( function ( entry ) {
			totalDuration += entry.duration;
		} );

		perfObserver.disconnect();
		return { totalEntries: totalEntries, totalDuration: totalDuration };
	}

	/**
	 * Get paint timing from browser that support the paint timing API.
	 * Some browsers (meaning Safari) do not implement first paint.
	 *
	 * @return {{firstPaint: number | undefined, firstContentfulPaint: number}}
	 */
	function getPaintTiming() {
		var firstPaint, firstContentfulPaint;

		// https://github.com/w3c/paint-timing/blob/08005b9ef104918ff372a0c6cc8f5339f6b46906/README.md
		var entries = perf.getEntriesByType( 'paint' );
		entries.forEach( function ( entry ) {
			if ( entry.name === 'first-paint' ) {
				firstPaint = Math.round( entry.startTime );
			} else if ( entry.name === 'first-contentful-paint' ) {
				firstContentfulPaint = Math.round( entry.startTime );
			}
		} );
		return { firstPaint: firstPaint, firstContentfulPaint: firstContentfulPaint };

	}

	/**
	 * Run a CPU benchmark inside a Worker (off the main thread) and
	 * emit the CpuBenchmark event afterward.
	 *
	 * This can be called from both showPerformanceSurvey() and onLoadComplete(),
	 * but it will only run the benchmark and emit the event once.
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:CpuBenchmark
	 * @param {Array} oversampleReasons List of zero or more oversample reason strings
	 * @return {jQuery.Promise}
	 */
	function emitCpuBenchmark( oversampleReasons ) {
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
			// Global `performance` was originally window-only, and later added to workers.
			// Support: Edge, IE 11, Safari < 11, Mobile Safari < 10.
			if ( !self.performance ) {
				postMessage( false );
				return;
			}

			var amount = 100000000;
			var startTime = performance.now();
			for ( var i = amount; i > 0; i-- ) {
				// empty
			}

			postMessage( Math.round( performance.now() - startTime ) );
		}

		work = 'onmessage = ' + String( onMessage );

		blob = new Blob( [ work ], { type: 'application/javascript' } );
		// eslint-disable-next-line compat/compat -- URL checked
		worker = new Worker( URL.createObjectURL( blob ) );

		worker.onmessage = function ( e ) {
			deferred.resolve( e.data );
			worker.terminate();
		};

		worker.postMessage( false );

		return deferred.then( function ( result ) {
			if ( !result ) {
				return;
			}

			var event = makeEventWithRequestContext( oversampleReasons );
			event.score = result;

			var batteryPromise = navigator.getBattery ?
				navigator.getBattery() :
				$.Deferred().reject();
			return batteryPromise.then(
				function ( battery ) {
					event.batteryLevel = battery.level;
					mw.eventLog.logEvent( 'CpuBenchmark', event );
				},
				function () {
					mw.eventLog.logEvent( 'CpuBenchmark', event );
				}
			);
		} );
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
			isVE = mw.util.getParamValue( 'veaction' ),
			exists = mw.config.get( 'wgCurRevisionId' ) > 0,
			surveyName = config.surveyName,
			loggedOutSamplingFactor = config.surveySamplingFactor || 0,
			loggedInSamplingFactor = config.surveyAuthenticatedSamplingFactor || 0,
			isInSurveySample;

		// QuickSurveys are only meant to be displayed on articles
		if ( isMainPage || !isArticle || !isViewing || isVE || !exists ||
			!surveyName || surveyDisplayed
		) {
			return;
		}

		surveyDisplayed = true;

		if ( mw.config.get( 'wgUserId' ) !== null ) {
			isInSurveySample = mw.eventLog.randomTokenMatch(
				loggedInSamplingFactor || loggedOutSamplingFactor
			);
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
		emitCpuBenchmark( [ 'survey:' + surveyName ] );
	}

	/**
	 * If the current page displays a CentralNotice banner, records its display time
	 *
	 * @param {PerformanceObserver} existingObserver
	 * @see https://meta.wikimedia.org/wiki/Schema:CentralNoticeTiming
	 */
	function emitCentralNoticeTiming( existingObserver ) {
		if ( !perf || !perf.getEntriesByName ) {
			return;
		}

		var marks = perf.getEntriesByName( 'mwCentralNoticeBanner', 'mark' );
		if ( !marks || !marks.length ) {
			if ( !window.PerformanceObserver ) {
				return;
			}

			// Already observing marks
			if ( existingObserver ) {
				return;
			}

			var observer = new PerformanceObserver( function () {
				emitCentralNoticeTiming( observer );
			} );

			observer.observe( { entryTypes: [ 'mark' ] } );

			return;
		} else {
			if ( existingObserver ) {
				existingObserver.disconnect();
			}

			var mark = marks[ 0 ];
			var event = {
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
		return !!( perf &&
			perf.timing &&
			perf.navigation &&
			perf.navigation.type === TYPE_NAVIGATE );
	}

	/**
	 * Collect the page load performance data and send the NavigationTiming beacon.
	 *
	 * Should not be called unless at least the Navigation Timing Level 1 API is
	 * available and isRegularNavigation() returns true.
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:NavigationTiming
	 * @param {Array} oversampleReasons List of zero or more oversample reason strings
	 */
	function emitNavigationTimingWithOversample( oversampleReasons ) {
		var event = makeEventWithRequestContext( oversampleReasons );

		// No need to wait for the RUM metrics to be recorded before showing the survey
		showPerformanceSurvey();

		// Properties: MediaWiki
		//
		// Custom properties from MediaWiki.
		event.mediaWikiVersion = mw.config.get( 'wgVersion' );

		// Skin like vector/vector-2022 etc
		event.skin = mw.config.get( 'skin' );

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

		var veaction = mw.util.getParamValue( 'veaction' );
		if ( veaction !== null ) {
			event.veaction = veaction;
		}

		if ( mediaWikiLoadEnd ) {
			event.mediaWikiLoadEnd = mediaWikiLoadEnd;
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

			if ( navigator.connection.rtt !== undefined ) {
				event.netinfoRtt = navigator.connection.rtt;
			}

			if ( navigator.connection.downlink !== undefined ) {
				event.netinfoDownlink = navigator.connection.downlink;
			}
		}

		if ( navigator.deviceMemory ) {
			event.deviceMemory = navigator.deviceMemory;
		}

		if ( navigator.hardwareConcurrency ) {
			event.hardwareConcurrency = navigator.hardwareConcurrency;
		}

		// Properties: LayoutShift from Layout Instability API
		//
		// https://developer.mozilla.org/en-US/docs/Web/API/Layout_Instability_API
		// https://wicg.github.io/layout-instability/#sec-layout-shift
		if ( window.PerformanceObserver && window.PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf( 'layout-shift' ) > -1 ) {
			event.cumulativeLayoutShift = getCumulativeLayoutShift();
		}

		if ( window.PerformanceObserver && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf( 'largest-contentful-paint' ) > -1 ) {
			var lcpInfo = getLargestContentfulPaint();
			event.largestContentfulPaint = lcpInfo.value;
			event.largestContentfulPaintElement = lcpInfo.element;
		}

		if ( perf.timing && perf.timing.msFirstPaint > perf.timing.navigationStart ) {
			// Support: IE 11, Microsoft Edge
			event.firstPaint = Math.round( perf.timing.msFirstPaint - perf.timing.navigationStart );
		} else if ( perf.getEntriesByType ) {
			var ptInfo = getPaintTiming();
			// First paint is missing in Safari
			if ( ptInfo.firstPaint ) {
				event.firstPaint = ptInfo.firstPaint;
			}
			if ( ptInfo.firstContentfulPaint ) {
				event.firstContentfulPaint = ptInfo.firstContentfulPaint;
			}
		}

		if ( window.PerformanceObserver && window.PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf( 'longtask' ) > -1 ) {
			var ltInfo = getLongTask();
			event.longTaskTotalDuration = ltInfo.totalDuration;
			event.longTaskTotalTasks = ltInfo.totalEntries;
		}

		// Properties: Navigation Timing Level 2
		//
		// https://www.w3.org/TR/navigation-timing-2/#sec-PerformanceNavigationTiming
		//
		// Includes:
		// - Server Timing <https://w3c.github.io/server-timing/>
		var navigationEntry;
		try {
			navigationEntry = perf.getEntriesByType( 'navigation' )[ 0 ];
		} catch ( e ) {
			// Support: Safari < 11 (getEntriesByType missing)
		}
		if ( navigationEntry && navigationEntry.serverTiming ) {
			navigationEntry.serverTiming.forEach( function ( entry ) {
				if ( entry.name === 'cache' ) {
					event.cacheResponseType = entry.description;
				} else if ( entry.name === 'host' ) {
					event.cacheHost = entry.description;
				}
			} );
		}

		$.extend( event,
			getNavTimingLevel1()
		);

		mw.eventLog.logEvent( 'NavigationTiming', event );
	}

	/**
	 * Simple wrapper function for readability
	 */
	function emitNavigationTiming() {
		emitNavigationTimingWithOversample( [] );
	}

	/**
	 * Emit a SaveTiming event if this was the page load following an edit submission.
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:SaveTiming
	 */
	function emitSaveTiming() {
		var timing = perf && perf.timing;

		if ( !mw.config.get( 'wgPostEdit' ) || !timing ) {
			return;
		}

		var responseStart = timing.responseStart - timing.navigationStart;
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
		if ( perf && perf.now ) {
			// Record this now, for later use by emitNavigationTiming
			mediaWikiLoadEnd = Math.round( perf.now() );
		}
	}

	/**
	 * Run a callback currently loading ResourceLoader modules have settled.
	 *
	 * @return {jQuery.Deferred}
	 */
	function onMwLoadEnd() {
		var deferred = $.Deferred();
		var modules = window.RLPAGEMODULES;

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
			var count = modules.length;
			function decrement() {
				count--;
				if ( count === 0 ) {
					setMwLoadEnd();
					deferred.resolve();
				}
			}
			for ( var i = 0; i < modules.length; i++ ) {
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
		var geoOversamples = [];

		// Geo oversample depends on the global Geo, which is created by the
		// CentralNotice extension.  We don't depend on it, though, because
		// it's pretty heavy.
		if ( !Geo ) {
			return geoOversamples;
		}

		var myGeo = Geo.country || Geo.country_code;
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
		var userAgentSamples = [];

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
		for ( var userAgent in userAgents ) {
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
		var pageNamesSamples = [];

		// Look at each page name that's been selected for oversampling,
		// and check whether the current page matches.  If it does, do a random to select
		// whether or not to oversample in this case.
		var pageName = mw.config.get( 'wgPageName' );
		if ( pageName in pageNames ) {
			if ( mw.eventLog.randomTokenMatch( pageNames[ pageName ] ) ) {
				pageNamesSamples.push( pageName );
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
	 * Emit FeaturePolicyViolation entries
	 *
	 * @param {Array} reports An array of Report objects
	 * @param {ReportingObserver} observer The reporting observer watching feature-policy-violation
	 */
	function emitFeaturePolicyViolation( reports, observer ) {
		reports.forEach( function ( report ) {
			var event = {
				pageviewToken: mw.user.getPageviewToken(),
				url: report.url,
				featureId: report.body.featureId
			};

			if ( report.body.sourceFile ) {
				event.sourceFile = report.body.sourceFile;
			}

			if ( report.body.lineNumber ) {
				event.lineNumber = report.body.lineNumber;
			}

			if ( report.body.columnNumber ) {
				event.columnNumber = report.body.columnNumber;
			}

			mw.eventLog.logEvent( 'FeaturePolicyViolation', event );
			policyViolationEmitted++;
		} );

		if ( policyViolationEmitted > 20 ) {
			observer.disconnect();
		}
	}

	/**
	 * Observe Feature Policy Violation reports: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Feature-Policy
	 */
	function setupFeaturePolicyViolationObserver() {
		/* global ReportingObserver */
		if ( !window.ReportingObserver ) {
			return;
		}

		// eslint-disable-next-line compat/compat -- ReportingObserver checked
		var observer = new ReportingObserver( emitFeaturePolicyViolation, { buffered: true, types: [ 'feature-policy-violation' ] } );
		observer.observe();
	}

	/** @return {string[]} */
	function getOversampleReasons() {
		// Get any oversamples, and see whether we match
		var oversamples = config.oversampleFactor;
		var oversampleReasons = [];
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
				if ( mw.eventLog.randomTokenMatch( oversamples.wiki ) ) {
					oversampleReasons.push( 'wiki:' + mw.config.get( 'wgDBname' ) );
				}
			}
		}

		return oversampleReasons;
	}

	/**
	 * Called after loadEventEnd by onLoadComplete()
	 */
	function loadCallback() {
		// Maybe send SaveTiming beacon
		mw.hook( 'postEdit' ).add( emitSaveTiming );

		// Stop listening for 'visibilitychange' events
		$( document ).off( 'visibilitychange', setVisibilityChanged );

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

		if ( !isRegularNavigation() ) {
			return;
		}

		var oversampleReasons = getOversampleReasons();
		var isInSample = mw.eventLog.inSample( config.samplingFactor || 0 );
		if ( !oversampleReasons.length && !isInSample ) {
			// NavTiming: Not sampled
			return;
		}

		// These are events separate from NavigationTiming that emit under the
		// same circumstances as navigation timing sampling and oversampling.
		emitCentralNoticeTiming();
		setupFeaturePolicyViolationObserver();

		// Run a CPU microbenchmark for a portion of measurements
		if ( mw.eventLog.randomTokenMatch( config.cpuBenchmarkSamplingFactor || 0 ) ) {
			emitCpuBenchmark( oversampleReasons );
		}

		if ( isInSample ) {
			emitNavigationTiming();
		}

		if ( oversampleReasons.length ) {
			emitNavigationTimingWithOversample( oversampleReasons );
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
		visibilityChanged = typeof document.hidden !== 'undefined' ? document.hidden : false;
		if ( !visibilityChanged ) {
			$( document ).one( 'visibilitychange', setVisibilityChanged );
		}

		// Do the rest after loadEventEnd
		onLoadComplete( loadCallback );
	}

	if ( !window.QUnit ) {
		main();
	} else {
		/**
		 * For testing only. Subject to change any time.
		 *
		 * @private
		 */
		module.exports = {
			isRegularNavigation: isRegularNavigation,
			getOversampleReasons: getOversampleReasons,
			emitNavTiming: emitNavigationTiming,
			emitNavigationTimingWithOversample: emitNavigationTimingWithOversample,
			emitCentralNoticeTiming: emitCentralNoticeTiming,
			testGeoOversamples: testGeoOversamples,
			testUAOversamples: testUAOversamples,
			testPageNameOversamples: testPageNameOversamples,
			onMwLoadEnd: onMwLoadEnd,
			emitCpuBenchmark: emitCpuBenchmark,
			emitFeaturePolicyViolation: emitFeaturePolicyViolation,
			makeEventWithRequestContext: makeEventWithRequestContext,
			reinit: function ( mocks ) {
				// Reset initial state
				perf = mocks && mocks.performance || undefined;
				navigator = mocks && mocks.navigator || window.navigator;
				Geo = mocks && mocks.Geo || window.Geo;
				policyViolationEmitted = 0;
				visibilityChanged = false;

				// Call manually because, during test execution, actual
				// onLoadComplete will probably not have happened yet.
				setMwLoadEnd();
			}
		};

		config = {
			samplingFactor: 1,
			oversampleFactor: {
				geo: {
					XX: 1
				},
				wiki: 1
			}
		};
	}

}() );
