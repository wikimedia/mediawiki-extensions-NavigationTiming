/* eslint-env qunit */
( function () {
	'use strict';

	var navigationTiming = require( 'ext.navigationTiming' ),
		hasOwn = Object.hasOwnProperty,
		// https://www.w3.org/TR/navigation-timing-2/#the-performancenavigation-interface
		TYPE_NAVIGATE = 0,
		TYPE_RELOAD = 1;

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
	QUnit.test( 'Basic', function ( assert ) {
		var stub, event, expected, key,
			yearMs = 31536000 * 1000,
			clock = this.sandbox.useFakeTimers();

		this.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called once' );
		assert.equal( stub.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );
		event = stub.getCall( 0 ).args[ 1 ];

		expected = {
			// MediaWiki
			isAnon: 'boolean',
			isOversample: 'boolean',
			mediaWikiVersion: 'string',
			mediaWikiLoadEnd: 'number',

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

		for ( key in expected ) {
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
	QUnit.test( 'First view', function ( assert ) {
		var event, stub, expected, key, val,
			clock = this.sandbox.useFakeTimers();

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

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called once' );
		assert.equal( stub.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );
		event = stub.getCall( 0 ).args[ 1 ];

		expected = {
			// MediaWiki
			mediaWikiVersion: { type: 'string' },
			isOversample: { type: 'boolean' },
			mediaWikiLoadEnd: { type: 'number' },
			// Navigation Timing API
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
		};

		for ( key in expected ) {
			val = expected[ key ];
			if ( val.type ) {
				assert.strictEqual( typeof event[ key ], val.type, 'Type of ' + key );
			} else {
				assert.strictEqual( event[ key ], val, 'Value of ' + key );
			}
		}
	} );

	// Case with example values typical for a repeat view
	// where DNS, TCP, SSL etc. are cached/re-used.
	QUnit.test( 'Repeat view', function ( assert ) {
		var event, stub, expected, key, val,
			clock = this.sandbox.useFakeTimers();

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

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called once' );
		assert.equal( stub.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );
		event = stub.getCall( 0 ).args[ 1 ];

		expected = {
			// MediaWiki
			mediaWikiVersion: { type: 'string' },
			isOversample: { type: 'boolean' },
			mediaWikiLoadEnd: { type: 'number' },
			// Navigation Timing API
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
		};

		for ( key in expected ) {
			val = expected[ key ];
			if ( val.type ) {
				assert.strictEqual( typeof event[ key ], val.type, 'Type of ' + key );
			} else {
				assert.strictEqual( event[ key ], val, 'Value of ' + key );
			}
		}
	} );

	QUnit.test( 'Reloaded view', function ( assert ) {
		var stub,
			clock = this.sandbox.useFakeTimers();

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

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.loadCallback();

		clock.tick( 10 );

		assert.strictEqual( stub.args.length, 0, 'mw.eventLog.logEvent not called' );
	} );

	QUnit.test( 'Without Navigation Timing API', function ( assert ) {
		var stub,
			clock = this.sandbox.useFakeTimers();

		this.performance = undefined;
		this.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.loadCallback();

		clock.tick( 10 );

		assert.strictEqual( stub.args.length, 0, 'mw.eventLog.logEvent not called' );
	} );

	QUnit.test( 'Oversample config and activation', function ( assert ) {
		this.Geo = {
			country: 'XX'
		};
		this.reinit();

		// Test that the inGeoOversample correctly identifies whether or not
		// to oversample
		assert.propEqual( navigationTiming.testGeoOversamples( { XX: 1 } ), [ 'XX' ],
			'Geo oversample occurs when window.Geo.country is present in oversampleFactor' );
		assert.propEqual( navigationTiming.testGeoOversamples( { US: 1 } ), [],
			'Geo oversample does not occur when country is not in config' );
		assert.propEqual( navigationTiming.testGeoOversamples( {} ), [],
			'Geo oversample does not occur when geo is an empty object' );

		// Test that inUserAgentOversample correctly identifies whether or not
		// to oversample
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

		// Test that inPageNameOversample correctly identifies whether or not
		// to oversample
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

		this.sandbox.stub( mw.eventLog, 'randomTokenMatch', function () {
			return false;
		} );
		// Stub the random functions so that they return values that will always
		// result in inSample() being false
		this.sandbox.stub( Math, 'random' );
		Math.random.returns( 1.0 );
		this.sandbox.stub( window.crypto, 'getRandomValues' );
		window.crypto.getRandomValues.returns( [ 4294967295 ] );

		assert.propEqual( navigationTiming.testGeoOversamples( { XX: 2 } ), [],
			'When randomTokenMatch returns false, resulting list of geo oversamples is empty' );
		assert.propEqual( navigationTiming.testUAOversamples( { Chrome: 2 } ), [],
			'When randomTokenMatch returns false, the resulting list of oversample reasons is empty' );
	} );

	QUnit.test( 'emitOversampleNavigationTiming tests', function ( assert ) {
		var logEventStub, logFailureStub,
			clock = this.sandbox.useFakeTimers();

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().promise() );
		logFailureStub = this.sandbox.stub( mw.eventLog, 'logFailure' );

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

	QUnit.test( 'onMwLoadEnd - plain', function ( assert ) {
		window.RLPAGEMODULES = [ 'mediawiki.base' ];
		return navigationTiming.onMwLoadEnd().then( function () {
			assert.ok( true, 'called' );
		} );
	} );

	// FIXME: T299780
	QUnit.skip( 'onMwLoadEnd - controlled', function ( assert ) {
		var log = [];
		var clock = this.sandbox.useFakeTimers();
		mw.loader.state( {
			'test.mwLoadEnd.ok': 'loading',
			'test.mwLoadEnd.fail': 'loading',
			'test.mwLoadEnd.unrelated': 'loading'
		} );
		window.RLPAGEMODULES = [
			'test.mwLoadEnd.ok',
			'test.mwLoadEnd.fail'
		];
		// Mock async
		this.sandbox.stub( mw, 'requestIdleCallback', function ( fn ) {
			fn();
		} );

		navigationTiming.onMwLoadEnd().then( function () {
			log.push( 'call' );
		} );
		clock.tick( 10 );
		assert.propEqual( log, [], 'pending initially' );

		// Make sure that it doesn't stop waiting after the first error.
		mw.loader.state( { 'test.mwLoadEnd.fail': 'error' } );
		clock.tick( 10 );
		assert.propEqual( log, [], 'pending after fail' );

		mw.loader.state( { 'test.mwLoadEnd.ok': 'ready' } );
		clock.tick( 10 );
		assert.propEqual( log, [ 'call' ], 'resolved after fail+ok' );
	} );

	QUnit.test( 'Oversample Geo integration tests', function ( assert ) {
		var logEvent,
			navigationTimingEvents,
			clock = this.sandbox.useFakeTimers();

		// Mock PerformanceNavigation for TYPE_NAVIGATE
		this.performance.timing = {};
		// Mock Geo for country=XX
		this.Geo = {
			country: 'XX'
		};

		// Stub EventLogging
		logEvent = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEvent.returns( $.Deferred().promise() );
		// Stub mw.hook (unrelated)
		this.sandbox.stub( mw, 'hook', function () {
			return { add: function () {} };
		} );

		this.reinit();
		navigationTiming.loadCallback();

		clock.tick( 10 );

		// There should be two events
		assert.equal( logEvent.args.length, 2, '2 events were emitted' );

		// There should be one NavigationTiming event with isOversample == false
		assert.equal( logEvent.args.filter( function ( event ) {
			return event[ 1 ].isOversample === false && event[ 0 ] === 'NavigationTiming';
		} ).length, 1, 'Exactly one NavigationTiming event has isOversample === false' );

		// There should be one NavigationTiming event with isOversample == true
		assert.equal( logEvent.args.filter( function ( event ) {
			return event[ 1 ].isOversample === true && event[ 0 ] === 'NavigationTiming';
		} ).length, 1, 'Exactly one NavigationTiming event has isOversample === true' );

		// Delete properties that are expected to be different and check remainder
		logEvent.args.forEach( function ( event ) {
			delete event[ 1 ].isOversample;
			delete event[ 1 ].oversampleReason;
		} );

		navigationTimingEvents = logEvent.args.filter( function ( event ) {
			return event[ 0 ] === 'NavigationTiming';
		} );

		assert.deepEqual( navigationTimingEvents[ 0 ][ 1 ], navigationTimingEvents[ 1 ][ 1 ],
			'Oversample and regular sample contain the same data' );
	} );

	QUnit.test( 'Optional APIs', function ( assert ) {
		var stub, logEventStub,
			clock = this.sandbox.useFakeTimers();

		stub = this.sandbox.stub( this.performance, 'getEntriesByType' );
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

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().promise() );
		this.sandbox.stub( mw.eventLog, 'logFailure' );

		this.reinit();
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.equal( stub.callCount, 2,
			'getEntriesByType was called the expected amount of times' );

		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].transferSize,
			1234, 'transferSize value was set using the Navigtion Timing Level 2 call' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].cacheResponseType, 'miss', 'Description field from the cache server timing entry is passed along' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].cacheHost, 'cp0062', 'Description field from the host server timing entry is passed along' );

		assert.equal( mw.eventLog.logEvent.getCall( 1 ).args[ 0 ], 'PaintTiming', 'Schema name' );
		assert.equal( mw.eventLog.logEvent.getCall( 1 ).args[ 1 ].name,
			'first-paint', 'firstPaint value was set using the Paint Timing API call' );
		assert.equal( mw.eventLog.logEvent.getCall( 1 ).args[ 1 ].startTime,
			990, 'firstPaint value was set using the Paint Timing API call' );

	} );

	QUnit.test( 'emitCentralNoticeTiming', function ( assert ) {
		var logEventStub, perfStub,
			clock = this.sandbox.useFakeTimers();

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().resolve() );

		perfStub = this.sandbox.stub( this.performance, 'getEntriesByName' );

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

		// Prevent the real NavigationTiming emitNavigationTiming() from running
		this.sandbox.stub( mw.eventLog, 'inSample', false );

		this.reinit();

		navigationTiming.emitCentralNoticeTiming();

		clock.tick( 10 );

		assert.equal( mw.eventLog.logEvent.callCount, 1, 'CentralNoticeTiming event happened' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].time, 8896, 'Event with rounded numerical value' );
	} );

	QUnit.test( 'emitCpuBenchmark', function ( assert ) {
		var logEventStub,
			done = assert.async();

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().resolve() );

		this.reinit();
		navigationTiming.emitCpuBenchmark( [] ).then( function () {
			setTimeout( function () {
				assert.equal( mw.eventLog.logEvent.callCount, 1, 'CpuBenchmark event happened' );
				assert.ok( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].score > 0, 'Event with non-zero score' );
				assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].batteryLevel, 0.2, 'Event with expected battery level' );
				done();
			} );
		} );
	} );

	QUnit.test( 'Wiki oversampling', function ( assert ) {
		var logEvent,
			clock = this.sandbox.useFakeTimers();

		mw.config.set( 'wgDBname', 'foowiki' );

		this.sandbox.stub( mw.eventLog, 'randomTokenMatch', function () {
			return true;
		} );

		this.reinit();

		logEvent = this.sandbox.stub( mw.eventLog, 'logEvent' );

		navigationTiming.loadCallback();

		clock.tick( 10 );

		assert.equal( logEvent.args.filter( function ( event ) {
			return event[ 1 ].isOversample === true;
		} ).length, 1, '1 event with oversample == true' );

		assert.equal( logEvent.args.filter( function ( event ) {
			return event[ 1 ].oversampleReason === '["wiki:foowiki"]';
		} ).length, 1, '1 event with oversampleReason == wiki:foowiki' );
	} );

	QUnit.test( 'emitFeaturePolicyViolation', function ( assert ) {
		var i,
			fakeObserver = { disconnect: function () {} },
			stubObserver = this.sandbox.stub( fakeObserver, 'disconnect' ),
			logEvent = this.sandbox.stub( mw.eventLog, 'logEvent' );

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

		for ( i = 0; i < 50; i++ ) {
			navigationTiming.emitFeaturePolicyViolation( [ { url: 'foo', body: { featureId: 123 } } ], fakeObserver );
		}

		assert.ok( stubObserver.called, 'Observer diconnected when too many events collected' );
	} );

	QUnit.test( 'emitLayoutShift', function ( assert ) {
		var i,
			fakeObserver = { disconnect: function () {} },
			stubObserver = this.sandbox.stub( fakeObserver, 'disconnect' ),
			logEvent = this.sandbox.stub( mw.eventLog, 'logEvent' ),
			$foo = $( '<div class="class1 class2 class3" id="foobar"></div>' ),
			entries = [ { value: 0.05, lastInputTime: 1, startTime: 2, sources: [ { node: $foo[ 0 ] } ] } ];

		navigationTiming.emitLayoutShift( entries, fakeObserver );

		assert.equal( logEvent.getCall( 0 ).args[ 0 ], 'LayoutShift', 'Schema name' );
		assert.equal( logEvent.getCall( 0 ).args[ 1 ].value, 0.05, 'Shift value' );
		assert.equal( logEvent.getCall( 0 ).args[ 1 ].lastInputTime, 1, 'Last input time' );
		assert.equal( logEvent.getCall( 0 ).args[ 1 ].entryTime, 2, 'Entry time' );
		assert.equal( logEvent.getCall( 0 ).args[ 1 ].firstSourceNode, 'div#foobar.class1.class2.class3', 'First identified source node' );

		this.reinit();

		entries = [ { value: 0.05, lastInputTime: 1, startTime: 2, sources: [] } ];

		navigationTiming.emitLayoutShift( entries, fakeObserver );

		assert.equal( logEvent.getCall( 1 ).args[ 0 ], 'LayoutShift', 'Schema name' );
		assert.equal( logEvent.getCall( 1 ).args[ 1 ].value, 0.05, 'Shift value' );
		assert.equal( logEvent.getCall( 1 ).args[ 1 ].lastInputTime, 1, 'Last input time' );
		assert.equal( logEvent.getCall( 1 ).args[ 1 ].entryTime, 2, 'Entry time' );
		assert.equal( logEvent.getCall( 1 ).args[ 1 ].firstSourceNode, undefined, 'No source node when sources empty' );

		this.reinit();

		entries = [ { value: 0.05, lastInputTime: 1, startTime: 2, sources: [ null ] } ];

		navigationTiming.emitLayoutShift( entries, fakeObserver );

		assert.equal( logEvent.getCall( 2 ).args[ 0 ], 'LayoutShift', 'Schema name' );
		assert.equal( logEvent.getCall( 2 ).args[ 1 ].value, 0.05, 'Shift value' );
		assert.equal( logEvent.getCall( 2 ).args[ 1 ].lastInputTime, 1, 'Last input time' );
		assert.equal( logEvent.getCall( 2 ).args[ 1 ].entryTime, 2, 'Entry time' );
		assert.equal( logEvent.getCall( 2 ).args[ 1 ].firstSourceNode, undefined, 'No source node when sources empty' );

		this.reinit();

		entries = [ { value: 0.05, lastInputTime: 1, startTime: 2, sources: [ { node: null } ] } ];

		navigationTiming.emitLayoutShift( entries, fakeObserver );

		assert.equal( logEvent.getCall( 3 ).args[ 0 ], 'LayoutShift', 'Schema name' );
		assert.equal( logEvent.getCall( 3 ).args[ 1 ].value, 0.05, 'Shift value' );
		assert.equal( logEvent.getCall( 3 ).args[ 1 ].lastInputTime, 1, 'Last input time' );
		assert.equal( logEvent.getCall( 3 ).args[ 1 ].entryTime, 2, 'Entry time' );
		assert.equal( logEvent.getCall( 3 ).args[ 1 ].firstSourceNode, undefined, 'No source node when first source node is null' );

		this.reinit();

		for ( i = 0; i < 50; i++ ) {
			navigationTiming.emitLayoutShift( entries, fakeObserver );
		}

		assert.ok( stubObserver.called, 'Observer diconnected when too many events collected' );
	} );

	QUnit.test( 'makeEventWithRequestContext', function ( assert ) {
		var event,
			stub,
			wgUserId = mw.config.get( 'wgUserId' ),
			wgMFMode = mw.config.get( 'wgMFMode' );

		stub = this.sandbox.stub( mw.user, 'getPageviewToken' );
		stub.returns( 'tokenfoo' );

		mw.config.set( 'wgUserId', 123 );
		mw.config.set( 'wgMFMode', 'stable' );

		this.Geo = {
			country: 'XX'
		};
		this.reinit();

		event = navigationTiming.makeEventWithRequestContext( [] );

		assert.equal( event.pageviewToken, 'tokenfoo', 'Pageview token' );
		assert.equal( event.isAnon, false, 'User is not anonymous' );
		assert.equal( event.isOversample, false, 'Pageview is not oversampled' );
		assert.equal( event.mobileMode, 'stable', 'Mobile mode is stable' );
		assert.equal( event.originCountry, 'XX', 'Country' );

		mw.config.set( 'wgUserId', null );

		event = navigationTiming.makeEventWithRequestContext( [ 'foo:bar', 'baz:biz' ] );

		assert.equal( event.isAnon, true, 'User is anonymous' );
		assert.equal( event.isOversample, true, 'Pageview is oversampled' );
		assert.equal( event.oversampleReason, '["foo:bar","baz:biz"]', 'Oversample reason is set' );

		mw.config.set( 'wgUserId', wgUserId );
		mw.config.set( 'wgMFMode', wgMFMode );
	} );
}() );
