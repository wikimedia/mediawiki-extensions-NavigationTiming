/* eslint-env qunit */

( function ( mw ) {
	'use strict';

	var navigationTiming = require( 'ext.navigationTiming' ),
		// https://www.w3.org/TR/navigation-timing-2/#the-performancenavigation-interface
		TYPE_NAVIGATE = 0,
		TYPE_RELOAD = 1;

	QUnit.module( 'ext.navigationTiming', QUnit.newMwEnvironment( {
		setup: function () {

			// Ensure the starting value of these parameters, regardless of what's
			// set in LocalSettings.php
			mw.config.set( 'wgNavigationTimingOversampleFactor', false );

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
			this.Uint32Array = window.Uint32Array;
			window.Uint32Array = { };

			// Can't stub window.navigator
			this.navigator = Object.getOwnPropertyDescriptor( window, 'navigator' ) || {};
			delete window.navigator;
			window.navigator = {
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.12345.94 Safari/537.36',
				connection: {
					effectiveType: '4g'
				}
			};
		},
		teardown: function () {
			window.Geo = this.Geo;
			window.chrome = this.chrome;
			if ( this.Uint32Array ) {
				window.Uint32Array = this.Uint32Array;
			} else {
				delete window.Uint32Array;
			}
			delete window.navigator;
			Object.defineProperty( window, 'navigator', this.navigator );
		}
	} ) );

	QUnit.test( 'inSample - Math.random()', function ( assert ) {
		var randStub,
			navTiming = require( 'ext.navigationTiming' );

		randStub = this.sandbox.stub( Math, 'random' );

		randStub.returns( 0.99 );
		assert.strictEqual( navTiming.inSample( 0 ), false, '0 is never' );
		assert.strictEqual( navTiming.inSample( 0.9 ), false, '0.9 is never' );
		assert.strictEqual( navTiming.inSample( 1 ), true, '1 is always' );
		assert.strictEqual( navTiming.inSample( '1' ), false, 'non-number is never' );
		assert.strictEqual( navTiming.inSample( 2 ), false, '2 not this time' );
		assert.strictEqual( randStub.callCount, 2, 'Math.random() stub method called 2 times' );
		randStub.reset();

		randStub.returns( 0.01 );
		assert.strictEqual( navTiming.inSample( 0 ), false, '0 is never' );
		assert.strictEqual( navTiming.inSample( 1 ), true, '1 is always' );
		assert.strictEqual( navTiming.inSample( 2 ), true, '2 this time' );
		assert.strictEqual( randStub.callCount, 2, 'Math.random() stub method was called 2 times' );
	} );

	QUnit.test( 'inSample - crypto', function ( assert ) {
		var navTiming = require( 'ext.navigationTiming' ),
			getRandomStub = this.sandbox.stub( window.crypto, 'getRandomValues' );

		window.Uint32Array = function () {};

		getRandomStub.returns( [ 4294967294 ] );
		assert.strictEqual( navTiming.inSample( 0 ), false, '0 is never' );
		assert.strictEqual( navTiming.inSample( 0.9 ), false, '0.9 is never' );
		assert.strictEqual( navTiming.inSample( 1 ), true, '1 is always' );
		assert.strictEqual( navTiming.inSample( '1' ), false, 'non-number is never' );
		assert.strictEqual( navTiming.inSample( 2 ), false, '2 not this time' );
		assert.strictEqual( getRandomStub.callCount, 2, 'crypto.getRandomValues() was called 2 times' );
		getRandomStub.reset();

		getRandomStub.returns( [ 1 ] );
		assert.strictEqual( navTiming.inSample( 0 ), false, '0 is never' );
		assert.strictEqual( navTiming.inSample( 1 ), true, '1 is always' );
		assert.strictEqual( navTiming.inSample( 2 ), true, '2 this time' );
		assert.strictEqual( getRandomStub.callCount, 2, 'getRandomValues() was called 2 times' );
	} );

	// Basic test will ensure no exceptions are thrown and various
	// of the core properties are set as expected.
	QUnit.test( 'Basic', function ( assert ) {
		var stub, event, expected, key;

		this.sandbox.stub( window, 'performance', {
			timing: performance.timing,
			navigation: {
				// Use TYPE_NAVIGATE in the stub, since we don't collect types
				// such as TYPE_RELOAD.
				type: TYPE_NAVIGATE,
				redirectCount: 0
			}
		} );
		navigationTiming.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		navigationTiming.emitNavTiming();
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

			// Navigation Timing API
			responseStart: 'number',
			domComplete: 'number',
			loadEventEnd: 'number'
		};

		for ( key in expected ) {
			assert.strictEqual( typeof event[ key ], expected[ key ], 'Type of ' + key );
		}

		// Make sure things still work when the connection object isn't present
		stub.reset();
		delete window.navigator.connection;
		navigationTiming.reinit();
		navigationTiming.emitNavTiming();
		event = stub.getCall( 0 ).args[ 1 ];
		assert.strictEqual( event.hasOwnProperty( 'netinfoEffectiveConnectionType' ),
			false, 'When the connection object is not present, things still work' );

		// Make sure things are correct if the page is a special page
		stub.reset();
		mw.config.set( 'wgCanonicalSpecialPageName', 'SpecialPageNameTest' );
		navigationTiming.reinit();
		navigationTiming.emitNavTiming();
		event = stub.getCall( 0 ).args[ 1 ];
		assert.strictEqual( event.mwSpecialPageName, 'SpecialPageNameTest',
			'Special page name is correct in the emitted object' );
		assert.strictEqual( event.hasOwnProperty( 'namespaceId' ), false,
			'namespaceId is not included for Special Pages' );
		assert.strictEqual( event.hasOwnProperty( 'revId' ), false,
			'revId is not included for Special pages' );
	} );

	// Case with example values typical for a first view
	// where DNS, TCP, SSL etc. all need to happen.
	QUnit.test( 'First view', function ( assert ) {
		var event, stub, expected, key, val;

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
				loadEventEnd: 575,
				unload: 0,
				redirecting: 0
			},
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			}
		} );

		navigationTiming.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		navigationTiming.emitNavTiming();
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
		var event, stub, expected, key, val;

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
		navigationTiming.emitNavTiming();
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
		var event, stub, expected, key;

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
				loadEventEnd: 575,
				unload: 0,
				redirecting: 0
			},
			navigation: {
				type: TYPE_RELOAD,
				redirectCount: 0
			}
		} );
		navigationTiming.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		navigationTiming.emitNavTiming();
		assert.strictEqual( stub.args.length, 1, 'mw.eventLog.logEvent was called' );
		assert.equal( stub.args[ 0 ][ 0 ], 'NavigationTiming', 'Schema name' );
		event = stub.args[ 0 ][ 1 ];

		expected = {
			// MediaWiki
			mediaWikiVersion: 'string',
			isOversample: 'boolean',
			mediaWikiLoadEnd: 'number',
			// Navigation Timing API: Not included for TYPE_RELOAD
			requestStart: 'undefined',
			redirecting: 'undefined',
			gaps: 'undefined'
		};

		for ( key in expected ) {
			assert.strictEqual( typeof event[ key ], expected[ key ], 'Type of ' + key );
		}
	} );

	QUnit.test( 'Without Navigation Timing API', function ( assert ) {
		var event, stub, expected, key;

		this.sandbox.stub( window, 'performance', undefined );
		navigationTiming.reinit();

		stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		navigationTiming.emitNavTiming();
		assert.strictEqual( stub.args.length, 1, 'mw.eventLog.logEvent was called' );
		assert.equal( stub.args[ 0 ][ 0 ], 'NavigationTiming', 'Schema name' );
		event = stub.args[ 0 ][ 1 ];

		expected = {
			// MediaWiki
			mediaWikiVersion: 'string',
			isOversample: 'boolean',
			mediaWikiLoadEnd: 'number',
			// Navigation Timing API: Unsupported
			requestStart: 'undefined',
			redirecting: 'undefined',
			gaps: 'undefined'
		};

		for ( key in expected ) {
			assert.strictEqual( typeof event[ key ], expected[ key ], 'Type of ' + key );
		}
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

		// Stub the random functions so that they return values that will always
		// result in inSample() being false
		this.sandbox.stub( Math, 'random' );
		Math.random.returns( 1.0 );
		this.sandbox.stub( window.crypto, 'getRandomValues' );
		window.crypto.getRandomValues.returns( [ 4294967295 ] );
		assert.propEqual( navigationTiming.testGeoOversamples( { XX: 2 } ), [],
			'When inSample returns false, resulting list of geo oversamples is empty' );
		assert.propEqual( navigationTiming.testUAOversamples( { Chrome: 2 } ), [],
			'When inSample returns false, the resulting list of oversample reasons is empty' );
		Math.random.restore();
		window.crypto.getRandomValues.restore();
	} );

	QUnit.test( 'emitOversampleNavigationTiming tests', function ( assert ) {
		var logEventStub, logFailureStub;

		logEventStub = this.sandbox.stub( mw.eventLog, 'logEvent' );
		logFailureStub = this.sandbox.stub( mw.eventLog, 'logFailure' );

		navigationTiming.emitNavTiming();
		assert.equal( logEventStub.args[ 0 ][ 1 ].isOversample, false,
			'Calling emitNavTiming emits an event with isOversample = false' );
		logEventStub.reset();

		navigationTiming.emitNavigationTimingWithOversample( [ 'UA:Chrome' ] );
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
		assert.equal( logEventStub.callCount, 1,
			'Calling eONT with mutiple oversample reasons triggers logEvent only once' );
		assert.equal( logEventStub.args[ 0 ][ 1 ].isOversample, true,
			'Calling eONT with multiple reasons results in isOversample set to true' );
		assert.propEqual( JSON.parse( logEventStub.args[ 0 ][ 1 ].oversampleReason ),
			[ 'UA:Chrome', 'geo:XX' ], 'Both reasons listed after calling ENTWO' );
	} );

	QUnit.test( 'Oversample Geo integration tests', function ( assert ) {
		var logEvent;

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
		// Stub mw.hook (unrelated)
		this.sandbox.stub( mw, 'hook', function () {
			return { add: function () {} };
		} );

		navigationTiming.reinit();
		navigationTiming.loadCallback();

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

	QUnit.test( 'Paint Timing API', function ( assert ) {
		this.sandbox.stub( window, 'performance', {
			timing: { /* empty stub */ },
			navigation: {
				type: TYPE_NAVIGATE,
				redirectCount: 0
			},
			getEntriesByType: function () { }
		} );
		this.sandbox.stub( window.performance, 'getEntriesByType' ).returns(
			[
				{
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
				} ] );
		this.sandbox.stub( mw.eventLog, 'logEvent' );
		this.sandbox.stub( mw.eventLog, 'logFailure' );

		navigationTiming.reinit();
		navigationTiming.emitNavTiming();

		assert.equal( window.performance.getEntriesByType.callCount, 2,
			'getEntriesByType was called twice' );
		assert.equal( mw.eventLog.logEvent.getCall( 0 ).args[ 1 ].firstPaint,
			990, 'firstPaint value was set using the Paint Timing API call' );

	} );
}( mediaWiki ) );
