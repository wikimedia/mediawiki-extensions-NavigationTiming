/* eslint-env qunit */
( function () {
	'use strict';

	var navigationTiming = require( 'ext.navigationTiming' );
	var hasOwn = Object.hasOwnProperty;
	// https://www.w3.org/TR/navigation-timing-2/#the-performancenavigation-interface
	var TYPE_NAVIGATE = 0;
	var TYPE_RELOAD = 1;

	QUnit.module( 'ext.navigationTiming', {
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

			window.RLPAGEMODULES = [];
		},
		afterEach: function () {
			window.Geo = this.Geo;
			window.RLPAGEMODULES = [];
			navigationTiming.reinit( {
				performance: window.performance
			} );
		}
	} );

	// Basic test will ensure no exceptions are thrown and various
	// of the core properties are set as expected.
	QUnit.test( 'emitNavTiming - Basic', function ( assert ) {
		var clock = this.sandbox.useFakeTimers();
		this.reinit();

		var stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavTiming();
		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called once' );
		assert.equal( stub.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );
		var event = stub.getCall( 0 ).args[ 1 ];

		var expected = {
			// MediaWiki
			isAnon: 'boolean',
			isOversample: 'boolean',
			mediaWikiVersion: 'string',
			mediaWikiLoadEnd: 'number',
			skin: 'string',
			// NetworkInfo API
			netinfoEffectiveConnectionType: 'string',
			netinfoConnectionType: 'string',
			netinfoRtt: 'number',
			netinfoDownlink: 'number',
			// Device Memory API
			deviceMemory: 'number',
			// HTML Living Standard
			hardwareConcurrency: 'number',
			// Navigation Timing API
			responseStart: 'number',
			domComplete: 'number',
			loadEventEnd: 'number'
		};

		var yearMs = 31536000 * 1000;
		for ( var key in expected ) {
			assert.strictEqual( typeof event[ key ], expected[ key ], 'Type of ' + key );
			if ( expected[ key ] === 'number' ) {
				// Regression test for T160315
				// Assert the metric is an offset and not an absolute timestamp
				assert.pushResult( {
					// If this is less than a year in milliseconds, assume it's an offset.
					// Otherwise, it's probably a timestamp which is wrong.
					result: event[ key ] < yearMs,
					actual: event[ key ],
					expected: yearMs,
					message: key + ' must be an offset, not a timestamp'
				} );
			}
		}

		// Make sure things still work when the connection object isn't present
		stub.reset();
		delete this.navigator.connection;
		delete this.navigator.deviceMemory;
		delete this.navigator.hardwareConcurrency;
		this.reinit();
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		event = stub.getCall( 0 ).args[ 1 ];
		assert.strictEqual( hasOwn.call( event, 'netinfoEffectiveConnectionType' ),
			false, 'When the connection object is not present, things still work' );
		assert.strictEqual( hasOwn.call( event, 'netinfoConnectionType' ),
			false, 'When the connection object is not present, things still work' );
		assert.strictEqual( hasOwn.call( event, 'deviceMemory' ),
			false, 'When the deviceMemory property is not present, things still work' );
		assert.strictEqual( hasOwn.call( event, 'hardwareConcurrency' ),
			false, 'When the hardwareConcurrency property is not present, things still work' );

		// Make sure things are correct if the page is a special page
		stub.reset();
		mw.config.set( 'wgCanonicalSpecialPageName', 'SpecialPageNameTest' );
		this.reinit();
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		event = stub.getCall( 0 ).args[ 1 ];
		assert.strictEqual( event.mwSpecialPageName, 'SpecialPageNameTest',
			'Special page name is correct in the emitted object' );
		assert.strictEqual( hasOwn.call( event, 'namespaceId' ), false,
			'namespaceId is not included for Special Pages' );
		assert.strictEqual( hasOwn.call( event, 'revId' ), false,
			'revId is not included for Special pages' );
	} );

	// Case with example values typical for a first view
	// where DNS, TCP, SSL etc. all need to happen.
	QUnit.test( 'emitNavTiming - First view', function ( assert ) {
		var clock = this.sandbox.useFakeTimers();
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
			domComplete: 450,
			loadEventStart: 570,
			loadEventEnd: 575
		};
		this.reinit();

		var stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavTiming();
		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called once' );
		assert.equal( stub.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );

		var event = stub.getCall( 0 ).args[ 1 ];
		assert.propContains( event, {
			connectStart: 126,
			secureConnectionStart: 135,
			connectEnd: 150,
			requestStart: 150,
			responseStart: 200,
			responseEnd: 300,
			domComplete: 350,
			loadEventStart: 470,
			loadEventEnd: 475,
			unload: 0,
			redirecting: 0,
			gaps: 131
		} );
	} );

	// Case with example values typical for a repeat view
	// where DNS, TCP, SSL etc. are cached/re-used.
	QUnit.test( 'emitNavTiming - Repeat view', function ( assert ) {
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
		navigationTiming.emitNavTiming();

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

	QUnit.test( 'testGeoOversamples()', function ( assert ) {
		this.Geo = {
			country: 'XX'
		};
		this.reinit();

		assert.propEqual( navigationTiming.testGeoOversamples( { XX: 1 } ), [ 'XX' ],
			'Match Geo.country' );
		assert.propEqual( navigationTiming.testGeoOversamples( { US: 1 } ), [],
			'Not matching Geo.country' );
		assert.propEqual( navigationTiming.testGeoOversamples( {} ), [],
			'Empty object' );
	} );

	QUnit.test( 'testUAOversamples()', function ( assert ) {
		this.reinit();

		assert.propEqual( navigationTiming.testUAOversamples( { Chrome: 1 } ), [ 'Chrome' ],
			'Generic Chrome user agent is identified and oversampled' );
		assert.propEqual( navigationTiming.testUAOversamples( { 'Chrome/62.0.12345.94': 1 } ),
			[ 'Chrome/62.0.12345.94' ],
			'Chrome with very specific UA is oversampled' );
		assert.propEqual( navigationTiming.testUAOversamples( {
			Chrome: 1,
			AppleWebKit: 1
		} ), [ 'Chrome', 'AppleWebKit' ], 'Most likely oversample rate is the one used' );
		assert.propEqual( navigationTiming.testUAOversamples( { FakeBrowser: 1 } ),
			[], 'Non-matching user agent is not sampled' );
	} );

	QUnit.test( 'testPageNameOversamples()', function ( assert ) {
		this.reinit();

		mw.config.set( 'wgPageName', 'File:Foo.jpg' );
		assert.propEqual( navigationTiming.testPageNameOversamples( { 'File:Foo.jpg': 1 } ), [ 'File:Foo.jpg' ],
			'File page is identified and oversampled' );
		mw.config.set( 'wgPageName', 'Something' );
		assert.propEqual( navigationTiming.testPageNameOversamples( { Something: 1 } ),
			[ 'Something' ],
			'Main name space article is oversampled' );
		assert.propEqual( navigationTiming.testPageNameOversamples( {
			'File:Foo.jpg': 1,
			Something: 1
		} ), [ 'Something' ], 'Only matching page name is sampled' );
		assert.propEqual( navigationTiming.testPageNameOversamples( { Foo: 1 } ),
			[], 'Non-matching page name is not sampled' );
	} );

	QUnit.test( 'Oversampling - unsampled', function ( assert ) {
		this.Geo = {
			country: 'XX'
		};
		this.sandbox.stub( mw.eventLog, 'randomTokenMatch', function () {
			return false;
		} );
		// Stub the random functions so that they return values that will always
		// result in inSample() being false
		this.sandbox.stub( Math, 'random' );
		Math.random.returns( 1.0 );
		this.sandbox.stub( window.crypto, 'getRandomValues' );
		window.crypto.getRandomValues.returns( [ 4294967295 ] );
		this.reinit();

		assert.propEqual( navigationTiming.testGeoOversamples( { XX: 2 } ), [],
			'When randomTokenMatch returns false, resulting list of geo oversamples is empty' );
		assert.propEqual( navigationTiming.testUAOversamples( { Chrome: 2 } ), [],
			'When randomTokenMatch returns false, the resulting list of oversample reasons is empty' );
	} );

	QUnit.test( 'emitOversampleNavigationTiming', function ( assert ) {
		var clock = this.sandbox.useFakeTimers();
		var logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().promise() );
		var logFailureStub = this.sandbox.stub( mw.eventLog, 'logFailure' );
		this.reinit();
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.equal( logEventStub.args[ 0 ][ 1 ].isOversample, false,
			'Calling emitNavTiming emits an event with isOversample = false' );
		logEventStub.reset();

		navigationTiming.emitNavigationTimingWithOversample( [ 'UA:Chrome' ] );

		clock.tick( 10 );

		assert.equal( logEventStub.called, true,
			'Calling emitOversampleNavigationTiming triggers logEvent' );
		assert.equal( logFailureStub.called, false,
			'Calling emitOversampleNavigationTiming does not trigger logFailure' );
		assert.equal( logEventStub.args[ 0 ][ 1 ].isOversample, true,
			'The event emitted had the isOversample flag set to true' );
		assert.propEqual( JSON.parse( logEventStub.args[ 0 ][ 1 ].oversampleReason ),
			[ 'UA:Chrome' ], 'The event emitted has the oversampleReason value set' );
		logEventStub.reset();

		navigationTiming.emitNavigationTimingWithOversample( [ 'UA:Chrome', 'geo:XX' ] );

		clock.tick( 10 );

		assert.strictEqual( logEventStub.callCount, 1,
			'Calling eONT with mutiple oversample reasons triggers logEvent only once' );
		assert.equal( logEventStub.args[ 0 ][ 1 ].isOversample, true,
			'Calling eONT with multiple reasons results in isOversample set to true' );
		assert.propEqual( JSON.parse( logEventStub.args[ 0 ][ 1 ].oversampleReason ),
			[ 'UA:Chrome', 'geo:XX' ], 'Both reasons listed after calling ENTWO' );
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

	QUnit.test( 'emitNavTiming - Optional APIs', function ( assert ) {
		var clock = this.sandbox.useFakeTimers();
		var stub = this.sandbox.stub( this.performance, 'getEntriesByType' );
		stub.withArgs( 'paint' ).returns(
			[ {
				duration: 0,
				entryType: 'paint',
				name: 'first-paint',
				startTime: 990.3000454
			} ]
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

		mw.config.set( 'wgNamespaceNumber', 1 );
		mw.config.set( 'wgAction', 'view' );
		mw.config.set( 'skin', 'vector' );
		mw.config.set( 'wgCanonicalSpecialPageName', undefined );

		this.reinit();
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.equal( stub.callCount, 2, 'getEntriesByType calls' );

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
			longTaskTotalDuration: 179
		}, 'Event data' );

		assert.equal( mw.eventLog.logEvent.getCall( 1 ).args[ 0 ], 'PaintTiming', 'Schema name' );
		assert.propContains( mw.eventLog.logEvent.getCall( 1 ).args[ 1 ], {
			name: 'first-paint',
			startTime: 990,
			skin: 'vector',
			action: 'view',
			namespaceId: 1
		}, 'Event data' );
	} );

	QUnit.test( 'emitCentralNoticeTiming', function ( assert ) {
		var clock = this.sandbox.useFakeTimers();
		var logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().resolve() );
		var perfStub = this.sandbox.stub( this.performance, 'getEntriesByName' );
		this.reinit();

		navigationTiming.emitCentralNoticeTiming();

		assert.equal( mw.eventLog.logEvent.callCount, 0, 'No mwCentralNoticeBanner performance mark' );

		perfStub.withArgs( 'mwCentralNoticeBanner', 'mark' ).returns(
			[ {
				duration: 0,
				entryType: 'mark',
				name: 'mwCentralNoticeBanner',
				startTime: 8895.899999999983
			} ]
		);
		this.reinit();

		navigationTiming.emitCentralNoticeTiming();

		clock.tick( 10 );

		assert.equal( mw.eventLog.logEvent.callCount, 1, 'CentralNoticeTiming event happened' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].time, 8896, 'Event with rounded numerical value' );
	} );

	QUnit.test( 'emitCpuBenchmark', function ( assert ) {
		var events = [];
		this.sandbox.stub( mw.eventLog, 'logEvent', function ( schema, event ) {
			events.push( { schema: schema, event: event } );
			return $.Deferred().resolve();
		} );

		this.reinit();
		return navigationTiming.emitCpuBenchmark( [] ).then( function () {
			assert.propContains( events,
				[ {
					schema: 'CpuBenchmark',
					event: {
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

	QUnit.test( 'getOversampleReasons - by wiki', function ( assert ) {
		mw.config.set( 'wgDBname', 'foowiki' );
		this.sandbox.stub( mw.eventLog, 'randomTokenMatch', function () {
			return true;
		} );

		assert.deepEqual( navigationTiming.getOversampleReasons(), [ 'wiki:foowiki' ], 'reasons' );
	} );

	QUnit.test( 'emitFeaturePolicyViolation', function ( assert ) {
		var fakeObserver = { disconnect: function () {} };
		var stubObserver = this.sandbox.stub( fakeObserver, 'disconnect' );
		var logEvent = this.sandbox.stub( mw.eventLog, 'logEvent' );

		navigationTiming.emitFeaturePolicyViolation( [ { url: 'foo', body: { featureId: 123 } } ], fakeObserver );

		assert.equal( logEvent.getCall( 0 ).args[ 0 ], 'FeaturePolicyViolation', 'Schema name' );
		assert.equal( logEvent.getCall( 0 ).args[ 1 ].url, 'foo', 'Reported URL' );
		assert.equal( logEvent.getCall( 0 ).args[ 1 ].featureId, 123, 'Reported featureId' );
		assert.equal( logEvent.getCall( 0 ).args[ 1 ].sourceFile, undefined, 'Skiped sourceFile' );
		assert.equal( logEvent.getCall( 0 ).args[ 1 ].lineNumber, undefined, 'Skipped lineNumber' );
		assert.equal( logEvent.getCall( 0 ).args[ 1 ].columnNumber, undefined, 'Skipped columnNumber' );

		navigationTiming.emitFeaturePolicyViolation( [ {
			url: 'foo', body: { featureId: 123, sourceFile: 'baz', lineNumber: 4, columnNumber: 5 }
		} ], fakeObserver );

		assert.equal( logEvent.getCall( 1 ).args[ 0 ], 'FeaturePolicyViolation', 'Schema name' );
		assert.equal( logEvent.getCall( 1 ).args[ 1 ].url, 'foo', 'Reported URL' );
		assert.equal( logEvent.getCall( 1 ).args[ 1 ].featureId, 123, 'Reported featureId' );
		assert.equal( logEvent.getCall( 1 ).args[ 1 ].sourceFile, 'baz', 'Reported sourceFile' );
		assert.equal( logEvent.getCall( 1 ).args[ 1 ].lineNumber, 4, 'Reported lineNumber' );
		assert.equal( logEvent.getCall( 1 ).args[ 1 ].columnNumber, 5, 'Reported columnNumber' );

		this.reinit();

		for ( var i = 0; i < 50; i++ ) {
			navigationTiming.emitFeaturePolicyViolation( [ { url: 'foo', body: { featureId: 123 } } ], fakeObserver );
		}

		assert.ok( stubObserver.called, 'Observer diconnected when too many events collected' );
	} );

	QUnit.test( 'makeEventWithRequestContext', function ( assert ) {
		var wgUserId = mw.config.get( 'wgUserId' );
		var wgMFMode = mw.config.get( 'wgMFMode' );
		var stub = this.sandbox.stub( mw.user, 'getPageviewToken' );
		stub.returns( 'tokenfoo' );

		mw.config.set( 'wgUserId', 123 );
		mw.config.set( 'wgMFMode', 'stable' );

		this.Geo = {
			country: 'XX'
		};
		this.reinit();

		var event = navigationTiming.makeEventWithRequestContext( [] );
		assert.propContains( event, {
			pageviewToken: 'tokenfoo',
			isAnon: false,
			isOversample: false,
			mobileMode: 'stable',
			originCountry: 'XX'
		} );

		mw.config.set( 'wgUserId', null );
		event = navigationTiming.makeEventWithRequestContext( [ 'foo:bar', 'baz:biz' ] );
		assert.propContains( event, {
			isAnon: true,
			isOversample: true,
			oversampleReason: '["foo:bar","baz:biz"]'
		} );

		mw.config.set( 'wgUserId', wgUserId );
		mw.config.set( 'wgMFMode', wgMFMode );
	} );
}() );
