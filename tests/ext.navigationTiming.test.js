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
			// Because stubs can't work on undefined properties and the presence
			// of window.Geo and window.chrome isn't guaranteed
			this.Geo = window.Geo;
			if ( !window.Geo ) {
				window.Geo = {};
			}
			this.chrome = window.chrome;
			if ( !window.chrome ) {
				window.chrome = {};
			}

			// Can't stub window.navigator
			this.navigator = Object.getOwnPropertyDescriptor( window, 'navigator' ) || {};
			delete window.navigator;
			window.navigator = {
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.12345.94 Safari/537.36',
				connection: {
					effectiveType: '4g',
					type: 'cellular'
				},
				deviceMemory: 8
			};

			window.RLPAGEMODULES = [];
		},
		afterEach: function () {
			window.Geo = this.Geo;
			window.chrome = this.chrome;

			delete window.navigator;
			Object.defineProperty( window, 'navigator', this.navigator );
		}
	} );

	// Basic test will ensure no exceptions are thrown and various
	// of the core properties are set as expected.
	QUnit.test( 'Basic', function ( assert ) {
		var stub, event, expected, key,
			yearMs = 31536000 * 1000,
			clock = this.sandbox.useFakeTimers();

		this.sandbox.stub( window, 'performance', {
			timing: performance.timing,
			navigation: {
				// Use TYPE_NAVIGATE in the stub, since we don't collect types
				// such as TYPE_RELOAD.
				type: TYPE_NAVIGATE,
				redirectCount: 0
			},
			now: performance.now.bind( performance )
		} );
		navigationTiming.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called' );
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

			// Device Memory API
			deviceMemory: 'number',

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
		delete window.navigator.connection;
		delete window.navigator.deviceMemory;
		navigationTiming.reinit();
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		event = stub.getCall( 0 ).args[ 1 ];
		assert.strictEqual( hasOwn.call( event, 'netinfoEffectiveConnectionType' ),
			false, 'When the connection object is not present, things still work' );
		assert.strictEqual( hasOwn.call( event, 'netinfoConnectionType' ),
			false, 'When the connection object is not present, things still work' );
		assert.strictEqual( hasOwn.call( event, 'deviceMemory' ),
			false, 'When the deviceMemory property is not present, things still work' );

		// Make sure things are correct if the page is a special page
		stub.reset();
		mw.config.set( 'wgCanonicalSpecialPageName', 'SpecialPageNameTest' );
		navigationTiming.reinit();
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

		this.sandbox.stub( window, 'performance', {
			timing: {
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
			},
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			}
		} );

		navigationTiming.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called' );
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

		this.sandbox.stub( window, 'performance', {
			timing: {
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
			},
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			}
		} );

		navigationTiming.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called' );
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

		this.sandbox.stub( window, 'performance', {
			timing: {
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
			},
			navigation: {
				type: TYPE_RELOAD,
				redirectCount: 0
			}
		} );
		mw.config.set( 'wgNavigationTimingSamplingFactor', 1 );
		navigationTiming.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.loadCallback();

		clock.tick( 10 );

		assert.strictEqual( stub.args.length, 0, 'mw.eventLog.logEvent not called' );
	} );

	QUnit.test( 'Without Navigation Timing API', function ( assert ) {
		var stub,
			clock = this.sandbox.useFakeTimers();

		this.sandbox.stub( window, 'performance', undefined );
		mw.config.set( 'wgNavigationTimingSamplingFactor', 1 );
		navigationTiming.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		stub.returns( $.Deferred().promise() );
		navigationTiming.loadCallback();

		clock.tick( 10 );

		assert.strictEqual( stub.args.length, 0, 'mw.eventLog.logEvent not called' );
	} );

	QUnit.test( 'Oversample config and activation', function ( assert ) {
		// If navigation type is anything other than TYPE_NAVIGATE, the
		// check for whether to measure will fail.
		this.sandbox.stub( window, 'performance', {
			timing: performance.timing,
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			}
		} );

		navigationTiming.reinit();

		// Make sure that window.Geo represents us correctly.
		this.sandbox.stub( window, 'Geo', {
			country: 'XX'
		} );

		// Test that the inGeoOversample correctly identifies whether or not
		// to oversample
		assert.propEqual( navigationTiming.testGeoOversamples( { XX: 1 } ), [ 'XX' ],
			'Geo oversample occurs when window.Geo.country is present in wgNavigationTimingOversampleFactor' );
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

		// Mock at least navigation.type so that tests don't fail
		// on testrunner reload.
		this.sandbox.stub( window, 'performance', {
			timing: performance.timing,
			navigation: {
				type: TYPE_NAVIGATE
			}
		} );

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

		assert.equal( logEventStub.callCount, 1,
			'Calling eONT with mutiple oversample reasons triggers logEvent only once' );
		assert.equal( logEventStub.args[ 0 ][ 1 ].isOversample, true,
			'Calling eONT with multiple reasons results in isOversample set to true' );
		assert.propEqual( JSON.parse( logEventStub.args[ 0 ][ 1 ].oversampleReason ),
			[ 'UA:Chrome', 'geo:XX' ], 'Both reasons listed after calling ENTWO' );
	} );

	QUnit.test( 'onMwLoadEnd - plain', function ( assert ) {
		this.sandbox.stub( window, 'RLPAGEMODULES', [ 'mediawiki.base' ] );
		return navigationTiming.onMwLoadEnd().then( function () {
			assert.ok( true, 'called' );
		} );
	} );

	QUnit.test( 'onMwLoadEnd - controlled', function ( assert ) {
		var log = [];
		mw.loader.state( {
			'test.mwLoadEnd.ok': 'loading',
			'test.mwLoadEnd.fail': 'loading',
			'test.mwLoadEnd.unrelated': 'loading'
		} );
		this.sandbox.stub( window, 'RLPAGEMODULES', [
			'test.mwLoadEnd.ok',
			'test.mwLoadEnd.fail'
		] );
		// Mock async
		this.sandbox.stub( mw, 'requestIdleCallback', function ( fn ) {
			fn();
		} );
		this.sandbox.stub( window, 'setTimeout', function ( fn ) {
			fn();
		} );

		navigationTiming.onMwLoadEnd().then( function () {
			log.push( 'call' );
		} );
		assert.propEqual( log, [], 'pending initially' );

		// Make sure that it doesn't stop waiting after the first error.
		mw.loader.state( { 'test.mwLoadEnd.fail': 'error' } );
		assert.propEqual( log, [], 'pending after fail' );

		mw.loader.state( { 'test.mwLoadEnd.ok': 'ready' } );
		assert.propEqual( log, [ 'call' ], 'resolved after fail+ok' );
	} );

	QUnit.test( 'Oversample Geo integration tests', function ( assert ) {
		var logEvent,
			clock = this.sandbox.useFakeTimers();

		// Mock PerformanceNavigation for TYPE_NAVIGATE
		this.sandbox.stub( window, 'performance', {
			timing: { /* empty stub */ },
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			}
		} );
		// Mock Geo for country=XX
		this.sandbox.stub( window, 'Geo', {
			country: 'XX'
		} );
		// Mock config for oversampling country=XX
		mw.config.set( 'wgNavigationTimingSamplingFactor', 1 );
		mw.config.set( 'wgNavigationTimingOversampleFactor', {
			geo: {
				XX: 1
			}
		} );
		// Stub EventLogging
		logEvent = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEvent.returns( $.Deferred().promise() );
		// Stub mw.hook (unrelated)
		this.sandbox.stub( mw, 'hook', function () {
			return { add: function () {} };
		} );

		navigationTiming.reinit();
		navigationTiming.loadCallback();

		clock.tick( 10 );

		// There should be two events
		assert.equal( logEvent.args.length, 2, 'Two events were emitted' );

		// There should be one event with isOversample == false
		assert.equal( logEvent.args.filter( function ( event ) {
			return event[ 1 ].isOversample === false;
		} ).length, 1, 'Exactly one event has isOversample === false' );
		// There should be one event with isOversample == true
		assert.equal( logEvent.args.filter( function ( event ) {
			return event[ 1 ].isOversample === true;
		} ).length, 1, 'Exactly one event has isOversample === true' );

		// Delete properties that are expected to be different and check remainder
		[ logEvent.args[ 0 ], logEvent.args[ 1 ] ].forEach( function ( event ) {
			delete event[ 1 ].isOversample;
			delete event[ 1 ].oversampleReason;
		} );
		assert.deepEqual( logEvent.args[ 0 ][ 1 ], logEvent.args[ 1 ][ 1 ],
			'Oversample and regular sample contain the same data' );
	} );

	QUnit.test( 'Optional APIs', function ( assert ) {
		var stub, logEventStub,
			clock = this.sandbox.useFakeTimers();

		this.sandbox.stub( window, 'performance', {
			timing: { /* empty stub */ },
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			},
			getEntriesByType: function () { }
		} );

		stub = this.sandbox.stub( window.performance, 'getEntriesByType' );

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
				transferSize: 1234
			} ]
		);

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().promise() );
		this.sandbox.stub( mw.eventLog, 'logFailure' );

		navigationTiming.reinit();
		navigationTiming.emitNavTiming();

		clock.tick( 10 );

		assert.equal( window.performance.getEntriesByType.callCount, 2,
			'getEntriesByType was called the expected amount of times' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].firstPaint,
			990, 'firstPaint value was set using the Paint Timing API call' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].transferSize,
			1234, 'transferSize value was set using the Navigtion Timing Level 2 call' );

	} );

	QUnit.test( 'makeResourceTimingEvent', function ( assert ) {
		var event, resource;

		resource = { name: 'foo', invalidField: 'bar', startTime: 1234.56 };

		navigationTiming.reinit();
		event = navigationTiming.makeResourceTimingEvent( resource, 'test' );

		assert.equal( event.name, 'foo', 'Fields from the resource are passed along' );
		assert.equal( event.label, 'test', 'Custom label is set' );
		assert.equal( event.invalidField, undefined, 'Only whitelisted fields are included' );
		assert.equal( event.startTime, 1235, 'Float values are rounded' );
	} );

	QUnit.test( 'emitTopImageResourceTiming', function ( assert ) {
		var $div, logEventStub, perfStub,
			clock = this.sandbox.useFakeTimers();

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().resolve() );

		this.sandbox.stub( window, 'performance', {
			timing: { /* empty stub */ },
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			},
			getEntriesByType: function () { return []; }
		} );

		perfStub = this.sandbox.stub( window.performance, 'getEntriesByType' );

		$div = $( '<div>' ).addClass( 'mw-parser-output' ).appendTo( '#qunit-fixture' );
		$( '<img>' ).attr( 'src', '//foo/bar.jpg' ).attr( 'width', 50 ).attr( 'height', 50 ).appendTo( $div );
		$( '<img>' ).attr( 'src', '//foo/baz.jpg' ).appendTo( $div );

		navigationTiming.reinit();
		navigationTiming.emitTopImageResourceTiming();

		assert.equal( mw.eventLog.logEvent.callCount, 0, 'No ResourceTiming emitted when there is no qualifying image in the DOM' );

		$( '<img>' ).attr( 'src', '//foo/bax.jpg' ).attr( 'width', 200 ).attr( 'height', 200 ).appendTo( $div );

		navigationTiming.reinit();
		navigationTiming.emitTopImageResourceTiming();

		assert.equal( mw.eventLog.logEvent.callCount, 0, 'Top image found, but no matching ResourceTiming event' );

		perfStub.withArgs( 'resource' ).returns(
			[ {
				duration: 1902.7,
				entryType: 'resource',
				initiatorType: 'img',
				name: '//foo/bax.jpg',
				startTime: 8895.899999999983
			} ]
		);

		// Prevent the real NavigationTiming emitNavigationTiming() from running
		this.sandbox.stub( mw.eventLog, 'inSample', false );

		navigationTiming.reinit();
		navigationTiming.emitTopImageResourceTiming();

		clock.tick( 10 );

		assert.equal( mw.eventLog.logEvent.callCount, 1, 'Top image found and matching ResourceTiming event' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].label, 'top-image', 'Event with correct label' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].duration, 1903, 'Event with roundde numerical value' );
	} );

	QUnit.test( 'emitCentralNoticeTiming', function ( assert ) {
		var logEventStub, perfStub,
			clock = this.sandbox.useFakeTimers();

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().resolve() );

		this.sandbox.stub( window, 'performance', {
			timing: { /* empty stub */ },
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			},
			getEntriesByType: function () { return []; },
			getEntriesByName: function () { return []; }
		} );

		perfStub = this.sandbox.stub( window.performance, 'getEntriesByName' );

		navigationTiming.reinit();
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

		navigationTiming.reinit();

		navigationTiming.emitCentralNoticeTiming();

		clock.tick( 10 );

		assert.equal( mw.eventLog.logEvent.callCount, 1, 'CentralNoticeTiming event happened' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].time, 8896, 'Event with rounded numerical value' );
	} );

	QUnit.skip( 'emitCpuBenchmark', function ( assert ) {
		var logEventStub,
			done = assert.async();

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().resolve() );

		navigationTiming.reinit();
		navigationTiming.emitCpuBenchmark().then( function () {
			setTimeout( function () {
				assert.equal( mw.eventLog.logEvent.callCount, 1, 'CpuBenchmark event happened' );
				assert.ok( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].score > 0, 'Event with non-zero score' );
				done();
			} );
		} );
	} );

	QUnit.test( 'emitServerTiming', function ( assert ) {
		var logEventStub, perfStub;

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().promise() );

		perfStub = this.sandbox.stub( window.performance, 'getEntriesByType' );
		perfStub.withArgs( 'paint' ).returns( [] );
		perfStub.withArgs( 'resource' ).returns( [] );
		perfStub.withArgs( 'navigation' ).returns(
			[ {
				duration: 1902.7,
				entryType: 'navigation',
				initiatorType: 'navigation',
				name: 'http://127.0.0.1:6081/wiki/Main_Page',
				startTime: 0,
				serverTiming: [ {
					name: 'cache',
					description: 'miss (0)',
					duration: 0.0578
				} ]
			} ]
		);

		navigationTiming.reinit();
		navigationTiming.emitServerTiming();

		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].name, 'cache', 'Name field from the performance timing entry is passed along' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].description, 'miss (0)', 'Description field from the performance timing entry is passed along' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].duration, 0.0578, 'Duration field from the performance timing entry is passed along' );
	} );

	QUnit.test( 'emitRUMSpeedIndex', function ( assert ) {
		var stub, logEventStub,
			done = assert.async();

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logEventStub.returns( $.Deferred().resolve() );

		this.sandbox.stub( window, 'performance', {
			timing: { /* empty stub */ },
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			},
			getEntriesByType: function () { }
		} );

		stub = this.sandbox.stub( window.performance, 'getEntriesByType' );

		stub.withArgs( 'resource' ).returns(
			[ {
				duration: 1902.7,
				entryType: 'resource',
				name: 'http://dev.wiki.local.wmftest.net/w/resources/assets/poweredby_mediawiki_88x31.png',
				startTime: 8895.899999999983
			} ]
		);

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
				startTime: 1000.10101
			} ]
		);

		stub.withArgs( 'navigation' ).returns(
			[ {
				duration: 18544.49,
				entryType: 'navigation',
				name: 'http://dev.wiki.local.wmftest.net/wiki/Main_Page',
				startTime: 0,
				transferSize: 1234
			} ]
		);

		navigationTiming.reinit();
		navigationTiming.emitRUMSpeedIndex().then( function () {
			setTimeout( function () {
				assert.equal( mw.eventLog.logEvent.callCount, 1, 'RUMSpeedIndex event happened' );
				assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].RSI, 990, 'Event with expected RUMSpeedIndex' );
				done();
			} );
		} );
	} );
}() );
