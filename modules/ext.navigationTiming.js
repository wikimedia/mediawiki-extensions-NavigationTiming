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
	var visibilityChanged = false;

	var mediaWikiLoadEnd;
	var cpuBenchmarkDone;

	/**
	 * Shared context used by both NavigationTiming and CpuBenchmark schemas.
	 *
	 * These context fields are consumed by get_navigation_timing_context() in the navtiming.py
	 * daemon, and allow us to explore the data by facet in Prometheus/Grafana.
	 *
	 * These fields are also used by AS Report (performance/asoranking) to join between
	 * the two datasets.
	 *
	 * @return {Object}
	 */
	function getNavTimingSharedEvent() {
		var event = {
			// unique token for the pageview to cross-reference the request between schemas
			pageviewToken: mw.user.getPageviewToken(),
			// is the user anonymous or authenticated?
			isAnon: mw.config.get( 'wgUserId' ) === null,
			// This is old legacy from oversample
			// always false, the oversample is removed since we don't need it in Prometheus
			isOversample: false
		};

		// MobileFrontend mode (e.g. "stable" or "beta")
		var mobileMode = mw.config.get( 'wgMFMode' );
		if ( mobileMode ) {
			event.mobileMode = mobileMode;
		}

		if ( Geo && typeof Geo.country === 'string' ) {
			// based on IP address, which country was the request made from?
			event.originCountry = Geo.country;
		}

		return event;
	}

	/**
	 * Emit First Input Delay event to Schema:FirstInputDelay
	 *
	 * @param {Object} entry
	 * @param {PerformanceObserver} observer
	 */
	function emitFirstInputDelay( entry, observer ) {
		var event = {
			inputDelay: Math.round( entry.processingStart - entry.startTime ),
			skin: mw.config.get( 'skin' ),
			pageviewToken: mw.user.getPageviewToken(),
			// This is old legacy from oversample
			isOversample: false
		};

		if ( Geo && typeof Geo.country === 'string' ) {
			event.originCountry = Geo.country;
		}

		mw.eventLog.logEvent( 'FirstInputDelay', event );

		observer.disconnect();
	}

	/**
	 * Set up PerformanceObserver that will listen to First Input delay performance events.
	 */
	function setUpFirstInputDelayObserver() {
		var performanceObserver;

		if ( window.PerformanceObserver ) {
			performanceObserver = new PerformanceObserver( ( list, observer ) => {
				var entries = list.getEntries();
				if ( entries[ 0 ] ) {
					var firstEntry = entries[ 0 ];
					emitFirstInputDelay( firstEntry, observer );
				}
			} );

			try {
				performanceObserver.observe( { type: 'first-input', buffered: true } );
			} catch ( e ) {
			}
		}
	}

	/**
	 * Get Navigation Timing Level 1 metrics for Schema:NavigationTiming.
	 *
	 * @return {Object}
	 */
	function getNavTimingLevel1() {
		var timing = perf && perf.timing;
		if ( !timing ) {
			return {};
		}

		// Verify the key exists and that it is equal or above zero to avoid submit
		// of invalid/negative values after subtracting navStart.
		// While these keys are meant to be timestamps, they may be absent
		// or 0 where the measured operation did not ocurr.
		function validate( value ) {
			return ( typeof value === 'number' && value >= 0 ) ? value : undefined;
		}

		var navStart = timing.navigationStart;
		return {
			connectEnd: validate( timing.connectEnd - navStart ),
			connectStart: validate( timing.connectStart - navStart ),
			domComplete: validate( timing.domComplete - navStart ),
			domInteractive: validate( timing.domInteractive - navStart ),
			fetchStart: validate( timing.fetchStart - navStart ),
			loadEventEnd: validate( timing.loadEventEnd - navStart ),
			loadEventStart: validate( timing.loadEventStart - navStart ),
			requestStart: validate( timing.requestStart - navStart ),
			responseEnd: validate( timing.responseEnd - navStart ),
			responseStart: validate( timing.responseStart - navStart ),

			// It is not safe to unconditionally substract from secureConnectionStart
			// because the offset it set to 0 when a connection is reused (T176105)
			secureConnectionStart: timing.secureConnectionStart === 0 ?
				0 :
				validate( timing.secureConnectionStart - navStart ),

			// It is safe to unconditionally substract for dnsLookup
			// because when DNS is reused, its start/end offset simply match fetchStart.
			dnsLookup: timing.domainLookupEnd - timing.domainLookupStart,

			// Watchout: There are some fields that are handled differently than the rest
			// * redirectStart/redirectEnd,
			// * unloadEventStart/unloadEventEnd
			// * secureConnectionStart
			// They can be zeroes instead of timestamps.
			// See https://www.w3.org/TR/navigation-timing-2/
			redirecting: timing.redirectStart ?
				timing.redirectEnd - timing.redirectStart :
				0,

			unload: timing.unloadEventStart ?
				timing.unloadEventEnd - timing.unloadEventStart :
				0,

			// There are usually gaps between the offsets we measure above.
			gaps: ( timing.domainLookupStart - timing.fetchStart ) +
				( timing.connectStart - timing.domainLookupEnd ) +
				( timing.requestStart - timing.connectEnd ) +
				( timing.loadEventStart - timing.domComplete )
		};
	}

	/**
	 * Get Cumulative LayoutShift score.
	 *
	 * @return {number}
	 */
	function getCumulativeLayoutShift() {
		var perfObserver = new PerformanceObserver( () => {} );

		// See https://github.com/mmocny/web-vitals/wiki/Snippets-for-LSN-using-PerformanceObserver#max-session-gap1s-limit5s
		// https://github.com/GoogleChrome/web-vitals/blob/v3.1.0/src/onCLS.ts
		perfObserver.observe( { type: 'layout-shift', buffered: true } );
		var entries = perfObserver.takeRecords();
		var max = 0;
		var curr = 0;
		var firstTs = Number.NEGATIVE_INFINITY;
		var prevTs = Number.NEGATIVE_INFINITY;
		entries.forEach( ( entry ) => {
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
		var element, value, perfObserver = new PerformanceObserver( () => {
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

	function getLongTask( firstContentfulPaint ) {
		var perfObserver = new PerformanceObserver( () => {
		} );
		// https://github.com/w3c/longtasks/blob/6d0a5dff7f20083cff74f057822920fd7c731cef/README.md
		perfObserver.observe( { type: 'longtask', buffered: true } );
		var entries = perfObserver.takeRecords();
		var totalDuration = 0;
		var totalEntries = entries.length;
		var longTasksBeforeFcp = 0;
		var longTasksDurationBeforeFcp = 0;
		entries.forEach( ( entry ) => {
			totalDuration += entry.duration;
			if ( entry.startTime < firstContentfulPaint ) {
				longTasksBeforeFcp++;
				longTasksDurationBeforeFcp += entry.duration;
			}
		} );

		perfObserver.disconnect();
		return {
			totalEntries: totalEntries,
			totalDuration: totalDuration,
			longTasksBeforeFcp: longTasksBeforeFcp,
			longTasksDurationBeforeFcp: longTasksDurationBeforeFcp
		};
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
		entries.forEach( ( entry ) => {
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
	 * This is called from onLoadComplete().
	 *
	 * @see https://meta.wikimedia.org/wiki/Schema:CpuBenchmark
	 * @return {jQuery.Promise}
	 */
	function emitCpuBenchmark() {
		var deferred = $.Deferred();

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

		var work = 'onmessage = ' + String( onMessage );
		var blob = new Blob( [ work ], { type: 'application/javascript' } );
		var worker = new Worker( URL.createObjectURL( blob ) );

		worker.onmessage = function ( e ) {
			deferred.resolve( e.data );
			worker.terminate();
		};

		worker.postMessage( false );

		return deferred.then( ( result ) => {
			if ( !result ) {
				return;
			}

			var event = getNavTimingSharedEvent();
			event.score = result;

			var batteryPromise = navigator.getBattery ?
				navigator.getBattery() :
				$.Deferred().reject();
			return batteryPromise.then(
				( battery ) => {
					event.batteryLevel = battery.level;
					mw.eventLog.logEvent( 'CpuBenchmark', event );
				},
				() => {
					mw.eventLog.logEvent( 'CpuBenchmark', event );
				}
			);
		} );
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
	 */
	function emitNavigationTiming() {
		var event = getNavTimingSharedEvent();

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
		if ( window.PerformanceObserver && window.PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes( 'layout-shift' ) ) {
			event.cumulativeLayoutShift = getCumulativeLayoutShift();
		}

		if ( window.PerformanceObserver && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes( 'largest-contentful-paint' ) ) {
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

		if ( window.PerformanceObserver && window.PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes( 'longtask' ) ) {
			var ltInfo = getLongTask( event.firstContentfulPaint );
			event.longTaskTotalDuration = ltInfo.totalDuration;
			event.longTaskTotalTasks = ltInfo.totalEntries;
			event.longTasksBeforeFcp = ltInfo.longTasksBeforeFcp;
			event.longTasksDurationBeforeFcp = ltInfo.longTasksDurationBeforeFcp;
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
			navigationEntry.serverTiming.forEach( ( entry ) => {
				if ( entry.name === 'cache' ) {
					event.cacheResponseType = entry.description;
				} else if ( entry.name === 'host' ) {
					event.cacheHost = entry.description;
				}
			} );
		}

		Object.assign( event, getNavTimingLevel1() );

		mw.eventLog.logEvent( 'NavigationTiming', event );
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
			modules = mw.loader.getModuleNames().filter( ( module ) => mw.loader.getState( module ) === 'loading' );
		}

		// Wait for them to complete loading (regardless of failures). First, try a single
		// mw.loader.using() call. That's efficient, but has the drawback of being rejected
		// upon first failure. Fall back to tracking each module separately. We usually avoid
		// that because of high overhead for that internally to mw.loader.
		mw.loader.using( modules ).done( () => {
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
		} ).fail( () => {
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
		onMwLoadEnd().then( () => {
			// Defer one tick for loadEventEnd to get set.
			if ( document.readyState === 'complete' ) {
				setTimeout( callback );
			} else {
				window.addEventListener( 'load', () => {
					setTimeout( callback );
				} );
			}
		} );
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

		var isInSample = mw.eventLog.pageviewInSample( config.samplingFactor || 0 );
		if ( !isInSample ) {
			// NavTiming: Not sampled
			return;
		}

		// These are events separate from NavigationTiming that emit under the
		// same circumstances as navigation timing sampling.
		setUpFirstInputDelayObserver();

		// Run a CPU microbenchmark for a portion of measurements
		if ( mw.eventLog.randomTokenMatch( config.cpuBenchmarkSamplingFactor || 0 ) ) {
			emitCpuBenchmark();
		}

		if ( isInSample ) {
			emitNavigationTiming();
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
			emitNavigationTiming: emitNavigationTiming,
			emitFirstInputDelay: emitFirstInputDelay,
			onMwLoadEnd: onMwLoadEnd,
			emitCpuBenchmark: emitCpuBenchmark,
			reinit: function ( mocks ) {
				// Reset initial state
				perf = mocks && mocks.performance || undefined;
				navigator = mocks && mocks.navigator || window.navigator;
				Geo = mocks && mocks.Geo || window.Geo;
				visibilityChanged = false;

				// Call manually because, during test execution, actual
				// onLoadComplete will probably not have happened yet.
				setMwLoadEnd();
			}
		};

		config = {
			samplingFactor: 1
		};
	}

}() );
