/* eslint-env qunit */
( function () {
	'use strict';

	var navigationTiming = require( 'ext.navigationTiming' );
	// https://www.w3.org/TR/navigation-timing-2/#the-performancenavigation-interface
	var TYPE_NAVIGATE = 0;
	var TYPE_RELOAD = 1;

	QUnit.module( 'ext.navigationTiming', QUnit.newMwEnvironment( {
		beforeEach: function () {
			this.Geo = {};
			// Can't reliably stub window.navigator and window.performance
			// due to being read-only Window properties.
			this.navigator = {
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.12345.94 Safari/537.36',
				connection: {
					effectiveType: '4g',
					type: 'cellular',
					rtt: 900,
					downlink: 1.4
				},
				deviceMemory: 8,
				hardwareConcurrency: 4,
				getBattery: function () { return $.Deferred().resolve( { level: 0.2 } ); }
			};
			this.performance = {
				now: performance.now.bind( performance ),
				timing: performance.timing,
				navigation: {
					// Use TYPE_NAVIGATE in the stub, since we don't collect metrics on
					// page loads with TYPE_RELOAD.
					type: TYPE_NAVIGATE,
					redirectCount: 0
				},
				getEntriesByType: function () { return []; },
				getEntriesByName: function () { return []; }
			};
			this.reinit = function () {
				navigationTiming.reinit( {
					navigator: this.navigator,
					performance: this.performance,
					Geo: this.Geo
				} );
			};

			this.sandbox.stub( mw.user, 'getPageviewToken', function () {
				return '0000ffff0000ffff0000';
			} );

			mw.config.set( 'skin', 'vector' );
			mw.config.set( 'wgVersion', '0.0-example' );
			mw.config.set( 'wgNamespaceNumber', 1 );
			mw.config.set( 'wgAction', 'view' );
			mw.config.set( 'wgCanonicalSpecialPageName', undefined );

			window.RLPAGEMODULES = [];
		},
		afterEach: function () {
			window.Geo = this.Geo;
			window.RLPAGEMODULES = [];
			navigationTiming.reinit( {
				performance: window.performance
			} );
		}
	} ) );

	// Basic test will ensure no exceptions are thrown and various
	// of the core properties are set as expected.
	QUnit.test( 'emitNavigationTiming - Basic', function ( assert ) {
		var clock = this.sandbox.useFakeTimers();
		this.performance.now = function () {
			return 1234.56;
		};
		// Case with example values typical for a first view
		// where DNS, TCP, SSL etc. all need to happen.
		this.performance.timing = {
			navigationStart: 100,
			fetchStart: 200,
			domainLookupStart: 210,
			domainLookupEnd: 225,
			connectStart: 226,
			secureConnectionStart: 235,
			connectEnd: 250,
			redirectEnd: 0,
			redirectStart: 0,
			requestStart: 250,
			responseStart: 300,
			responseEnd: 400,
			domInteractive: 440,
			domComplete: 450,
			loadEventStart: 570,
			loadEventEnd: 575
		};
		var perfObserver = this.sandbox.stub( window, 'PerformanceObserver', function () {} );
		perfObserver.supportedEntryTypes = [];
		this.Geo = {
			country: 'XX'
		};
		this.reinit();

		var stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavigationTiming();
		clock.tick( 10 );

		assert.strictEqual( stub.callCount, 1, 'mw.eventLog.logEvent called' );
		assert.equal( stub.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );
		assert.propEqual( stub.getCall( 0 ).args[ 1 ], {
			// Page/user metadata
			action: 'view',
			isAnon: true,
			isOversample: false,
			mediaWikiVersion: '0.0-example',
			namespaceId: 1,
			pageviewToken: '0000ffff0000ffff0000',
			originCountry: 'XX',
			revId: null,
			skin: 'vector',
			// Device/connection metadata
			deviceMemory: 8,
			hardwareConcurrency: 4,
			netinfoConnectionType: 'cellular',
			netinfoDownlink: 1.4,
			netinfoEffectiveConnectionType: '4g',
			netinfoRtt: 900,
			// Page load
			fetchStart: 100,
			connectStart: 126,
			dnsLookup: 15,
			secureConnectionStart: 135,
			connectEnd: 150,
			requestStart: 150,
			responseStart: 200,
			responseEnd: 300,
			domInteractive: 340,
			domComplete: 350,
			loadEventStart: 470,
			loadEventEnd: 475,
			mediaWikiLoadEnd: 1235,
			unload: 0,
			redirecting: 0,
			gaps: 131
		}, 'Event object' );

		// Make sure things still work when the connection object isn't present
		delete this.navigator.connection;
		delete this.navigator.deviceMemory;
		delete this.navigator.hardwareConcurrency;
		this.reinit();

		stub.reset();
		navigationTiming.emitNavigationTiming();
		clock.tick( 10 );

		assert.strictEqual( stub.callCount, 1, 'mw.eventLog.logEvent called' );
		assert.propEqual( stub.getCall( 0 ).args[ 1 ], {
			// Page/user metadata
			action: 'view',
			isAnon: true,
			isOversample: false,
			mediaWikiVersion: '0.0-example',
			namespaceId: 1,
			pageviewToken: '0000ffff0000ffff0000',
			originCountry: 'XX',
			revId: null,
			skin: 'vector',
			// Device/connection metadata (ommitted)
			// Page load
			fetchStart: 100,
			connectStart: 126,
			dnsLookup: 15,
			secureConnectionStart: 135,
			connectEnd: 150,
			requestStart: 150,
			responseStart: 200,
			responseEnd: 300,
			domInteractive: 340,
			domComplete: 350,
			loadEventStart: 470,
			loadEventEnd: 475,
			mediaWikiLoadEnd: 1235,
			unload: 0,
			redirecting: 0,
			gaps: 131
		}, 'Event object, when device/connection info is unsupported' );

		// Make sure things are correct if the page is a special page
		mw.config.set( 'wgCanonicalSpecialPageName', 'MySpecialPage' );
		this.reinit();

		stub.reset();
		navigationTiming.emitNavigationTiming();
		clock.tick( 10 );

		assert.strictEqual( stub.callCount, 1, 'mw.eventLog.logEvent called' );
		assert.propEqual( stub.getCall( 0 ).args[ 1 ], {
			// Page/user metadata (omit 'action' and 'namespaceId', add 'mwSpecialPageName')
			isAnon: true,
			isOversample: false,
			mediaWikiVersion: '0.0-example',
			mwSpecialPageName: 'MySpecialPage',
			pageviewToken: '0000ffff0000ffff0000',
			originCountry: 'XX',
			skin: 'vector',
			// Device/connection metadata (omitted)
			// Page load
			fetchStart: 100,
			connectStart: 126,
			dnsLookup: 15,
			secureConnectionStart: 135,
			connectEnd: 150,
			requestStart: 150,
			responseStart: 200,
			responseEnd: 300,
			domInteractive: 340,
			domComplete: 350,
			loadEventStart: 470,
			loadEventEnd: 475,
			mediaWikiLoadEnd: 1235,
			unload: 0,
			redirecting: 0,
			gaps: 131
		}, 'Event object, on a special page' );
	} );

	// Case with example values typical for a repeat view
	// where DNS, TCP, SSL etc. are cached/re-used.
	QUnit.test( 'emitNavigationTiming - Repeat view', function ( assert ) {
		var clock = this.sandbox.useFakeTimers();
		this.performance.timing = {
			navigationStart: 100,
			fetchStart: 100,
			domainLookupStart: 100,
			domainLookupEnd: 100,
			connectStart: 100,
			secureConnectionStart: 0,
			connectEnd: 100,
			redirectStart: 10,
			redirectEnd: 20,
			requestStart: 110,
			responseStart: 200,
			responseEnd: 300,
			domComplete: 350,
			loadEventStart: 470,
			loadEventEnd: 475,
			unloadEventStart: 10,
			unloadEventEnd: 21
		};
		this.reinit();

		var stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavigationTiming();

		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called once' );
		assert.equal( stub.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );

		var event = stub.getCall( 0 ).args[ 1 ];
		assert.propContains( event, {
			dnsLookup: 0,
			connectStart: 0,
			secureConnectionStart: 0,
			connectEnd: 0,
			requestStart: 10,
			responseStart: 100,
			responseEnd: 200,
			domComplete: 250,
			loadEventStart: 370,
			loadEventEnd: 375,
			unload: 11,
			redirecting: 10
		} );
	} );

	QUnit.test( 'isRegularNavigation - reload', function ( assert ) {
		this.performance.timing = {
			navigationStart: 100,
			fetchStart: 200,
			domainLookupStart: 210,
			domainLookupEnd: 225,
			connectStart: 226,
			connectEnd: 250,
			redirectEnd: 0,
			redirectStart: 0,
			requestStart: 250,
			responseStart: 300,
			responseEnd: 400,
			domComplete: 450,
			loadEventStart: 570,
			loadEventEnd: 575
		};
		this.performance.navigation.type = TYPE_RELOAD;
		this.reinit();

		assert.false( navigationTiming.isRegularNavigation() );
	} );

	QUnit.test( 'isRegularNavigation - no Navigation Timing API', function ( assert ) {
		this.performance = undefined;
		this.reinit();

		assert.false( navigationTiming.isRegularNavigation() );
	} );

	QUnit.test( 'onMwLoadEnd - simple', function ( assert ) {
		window.RLPAGEMODULES = [ 'mediawiki.base' ];
		return navigationTiming.onMwLoadEnd().then( function () {
			assert.true( true, 'called' );
		} );
	} );

	QUnit.test( 'onMwLoadEnd - mixed states', function ( assert ) {
		mw.loader.state( {
			'test.mwLoadEnd.ok': 'loading',
			'test.mwLoadEnd.fail': 'loading',
			'test.mwLoadEnd.unrelated': 'loading'
		} );
		window.RLPAGEMODULES = [
			'test.mwLoadEnd.ok',
			'test.mwLoadEnd.fail'
		];
		this.sandbox.stub( mw, 'requestIdleCallback', function ( fn ) {
			// Run test callback immediately and more reliably
			fn();
		} );

		var promise = navigationTiming.onMwLoadEnd();

		//  Make sure that it doesn't stop waiting after the first error.
		mw.loader.state( { 'test.mwLoadEnd.fail': 'error' } );
		mw.loader.state( { 'test.mwLoadEnd.ok': 'ready' } );

		return promise.then( function () {
			assert.true( true, 'called' );
		} );
	} );

	QUnit.test( 'emitNavigationTiming - Optional APIs', function ( assert ) {
		var clock = this.sandbox.useFakeTimers();
		var stub = this.sandbox.stub( this.performance, 'getEntriesByType' );
		stub.withArgs( 'paint' ).returns(
			[ {
				duration: 0,
				entryType: 'paint',
				name: 'first-paint',
				startTime: 990.3000454
			},
			{
				duration: 0,
				entryType: 'paint',
				name: 'first-contentful-paint',
				startTime: 3085
			}
			]
		);
		stub.withArgs( 'navigation' ).returns(
			[ {
				duration: 18544.49,
				entryType: 'navigation',
				name: 'http://dev.wiki.local.wmftest.net/wiki/Main_Page',
				startTime: 0,
				transferSize: 1234,
				serverTiming: [ {
					name: 'cache',
					description: 'miss',
					duration: 0.0578
				},
				{
					name: 'host',
					description: 'cp0062',
					duration: 0
				} ]
			} ]
		);

		var performanceObserver = this.sandbox.stub( window, 'PerformanceObserver', function () {
			return {
				observe: function ( config ) { this.type = config.type; },
				disconnect: function () {},
				takeRecords: function () {
					if ( this.type === 'layout-shift' ) {
						return [
							{ startTime: 1000, value: 0.110498 },
							{ startTime: 1001, value: 0.005231 }
						];
					} else if ( this.type === 'largest-contentful-paint' ) {
						return [
							{ renderTime: 1000, element: { tagName: 'p' } },
							{ loadTime: 1100, renderTime: 1200, element: { tagName: 'img' } }
						];
					} else if ( this.type === 'longtask' ) {
						return [
							{ startTime: 2951, duration: 104 },
							{ startTime: 3285, duration: 75 }
						];
					}
				}
			};
		} );

		performanceObserver.supportedEntryTypes = [ 'layout-shift', 'largest-contentful-paint', 'longtask' ];

		var logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().promise() );
		this.sandbox.stub( mw.eventLog, 'logFailure' );

		this.reinit();
		navigationTiming.emitNavigationTiming();

		clock.tick( 10 );

		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );
		assert.propContains( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ], {
			// Server-Timing entry
			cacheResponseType: 'miss',
			cacheHost: 'cp0062',
			// Cumulative layout shift score
			cumulativeLayoutShift: 0.116,
			// Largest contentful paint render and element
			largestContentfulPaint: 1200,
			largestContentfulPaintElement: 'img',
			// longtask total entries and duration
			longTaskTotalTasks: 2,
			longTaskTotalDuration: 179,
			firstPaint: 990,
			firstContentfulPaint: 3085,
			longTasksBeforeFcp: 1,
			longTasksDurationBeforeFcp: 104
		}, 'Event data' );
	} );

	QUnit.test( 'FirstInputDelay: emitFirstInputDelay', function ( assert ) {
		var clock = this.sandbox.useFakeTimers();
		this.reinit();

		var stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );

		var entryMock = { processingStart: 5.4, startTime: 2.9 };
		var observerMock = { disconnect: function () {} };
		navigationTiming.emitFirstInputDelay( entryMock, observerMock );

		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called once' );
		var schemaName = stub.getCall( 0 ).args[ 0 ];
		var event = stub.getCall( 0 ).args[ 1 ];
		assert.equal( schemaName, 'FirstInputDelay', 'Schema name: FirstInputDelay' );
		assert.propEqual( event, {
			inputDelay: 3,
			isOversample: false,
			pageviewToken: '0000ffff0000ffff0000',
			skin: 'vector'
		} );
	} );

	QUnit.test( 'emitCpuBenchmark', function ( assert ) {
		var events = [];
		this.sandbox.stub( mw.eventLog, 'logEvent', function ( schema, event ) {
			events.push( { schema: schema, event: event } );
			return $.Deferred().resolve();
		} );
		this.Geo = {
			country: 'XX'
		};

		this.reinit();
		return navigationTiming.emitCpuBenchmark( [] ).then( function () {
			assert.propContains( events,
				[ {
					schema: 'CpuBenchmark',
					event: {
						pageviewToken: '0000ffff0000ffff0000',
						originCountry: 'XX',
						isAnon: true,
						isOversample: false,
						batteryLevel: 0.2
					}
				} ],
				'events'
			);

			assert.true( events[ 0 ].event.score > 0, 'event.score is non-zero' );
		} );
	} );
}() );
