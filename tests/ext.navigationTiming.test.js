/* eslint-env qunit */

( function ( mw ) {
	'use strict';

	var navigationTiming = require( 'ext.navigationTiming' );

	QUnit.module( 'ext.navigationTiming', QUnit.newMwEnvironment( {
		setup: function () {

			// Ensure the starting value of these paraeters, regardless of what's
			// set in LocalSettings.php
			mw.config.set( 'wgNavigationTimingFirstPaintAsiaSamplingFactor', 1 );
			mw.config.set( 'wgNavigationTimingOversampleFactor', {} );

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
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.12345.94 Safari/537.36'
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
		var stub, event, expected, key, type, val;

		this.sandbox.stub( window, 'performance', {
			timing: performance.timing,
			navigation: {
				// Force TYPE_NAVIGATE instead of e.g. TYPE_REDIRECT.
				// Since we only collect metrics from regular requests,
				// but we don't want that logic to apply to the unit test,
				// as otherwise it may omit the main Navigation Timing keys.
				type: 0,
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
			// Base
			isAnon: 'boolean',
			isHiDPI: 'boolean',
			isHttp2: 'boolean',
			isOversample: 'boolean',
			mediaWikiVersion: [ 'string', mw.config.get( 'wgVersion' ) ],

			// ResourceLoader
			mediaWikiLoadComplete: 'number',

			// Navigation Timing
			responseStart: 'number',
			domComplete: 'number',
			loadEventEnd: 'number'
		};

		for ( key in expected ) {
			if ( Array.isArray( expected[ key ] ) ) {
				type = expected[ key ][ 0 ];
				val = expected[ key ][ 1 ];
			} else {
				type = expected[ key ];
				val = undefined;
			}
			assert.strictEqual( typeof event[ key ], type, 'Type of event property: ' + key );
			if ( val !== undefined ) {
				assert.strictEqual( event[ key ], val, 'Value of event property: ' + key );
			}
		}
	} );

	// Case with example values typical for a first view
	// where DNS, TCP, SSL etc. all need to happen.
	QUnit.test( 'First view', function ( assert ) {
		var event, stub, expected, key, type, val;

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
				// type: TYPE_NAVIGATE
				type: 0,
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
			dnsLookup: [ 'number', 15 ],
			connectStart: [ 'number', 126 ],
			secureConnectionStart: [ 'number', 135 ],
			connectEnd: [ 'number', 150 ],
			requestStart: [ 'number', 150 ],
			responseStart: [ 'number', 200 ],
			responseEnd: [ 'number', 300 ],
			domComplete: [ 'number', 350 ],
			loadEventStart: [ 'number', 470 ],
			loadEventEnd: [ 'number', 475 ],
			unload: [ 'number', 0 ],
			redirecting: [ 'number', 0 ]
		};

		for ( key in expected ) {
			type = expected[ key ][ 0 ];
			val = expected[ key ][ 1 ];
			assert.strictEqual( typeof event[ key ], type, 'Type of event property: ' + key );
			assert.strictEqual( event[ key ], val, 'Value of event property: ' + key );
		}
	} );

	// Case with example values typical for a repeat view
	// where DNS, TCP, SSL etc. are cached/re-used.
	QUnit.test( 'Repeat view', function ( assert ) {
		var event, stub, expected, key, type, val;

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
				// type: TYPE_NAVIGATE
				type: 0,
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
			dnsLookup: [ 'number', 0 ],
			connectStart: [ 'number', 0 ],
			secureConnectionStart: [ 'number', 0 ],
			connectEnd: [ 'number', 0 ],
			requestStart: [ 'number', 10 ],
			responseStart: [ 'number', 100 ],
			responseEnd: [ 'number', 200 ],
			domComplete: [ 'number', 250 ],
			loadEventStart: [ 'number', 370 ],
			loadEventEnd: [ 'number', 375 ],
			unload: [ 'number', 11 ],
			redirecting: [ 'number', 10 ]
		};

		for ( key in expected ) {
			type = expected[ key ][ 0 ];
			val = expected[ key ][ 1 ];
			assert.strictEqual( typeof event[ key ], type, 'Type of event property: ' + key );
			assert.strictEqual( event[ key ], val, 'Value of event property: ' + key );
		}
	} );

	QUnit.test( 'Asia (old)', function ( assert ) {
		var stub = this.sandbox.stub( mw, 'track' );

		this.sandbox.stub( window, 'chrome', {
			loadTimes: function () {
				return { firstPaintTime: 1301637600.420 };
			}
		} );
		this.sandbox.stub( window, 'performance', {
			timing: { fetchStart: 1301637600000 },
			getEntriesByType: function () {
				return [];
			}
		} );

		navigationTiming.reinit();

		navigationTiming.emitAsiaFirstPaint();

		assert.deepEqual(
			stub.getCall( 0 ) && stub.getCall( 0 ).args,
			[ 'timing.frontend.navtiming_asia.firstPaint', 420 ],
			'First paint'
		);
		assert.strictEqual(
			stub.getCall( 1 ),
			null,
			'First contentful paint'
		);
	} );

	QUnit.test( 'Asia (new)', function ( assert ) {
		var stub = this.sandbox.stub( mw, 'track' );

		this.sandbox.stub( window, 'chrome', {
			loadTimes: function () {
				return { firstPaintTime: 1301637600.420 };
			}
		} );
		this.sandbox.stub( window, 'performance', {
			timing: { fetchStart: 1400000000000 },
			getEntriesByType: function () {
				return [
					// navigation
					{ fetchStart: 15 },
					// paint
					{ name: 'first-paint', startTime: 615 },
					{ name: 'first-contentful-paint', startTime: 655 }
				];
			}
		} );

		navigationTiming.reinit();

		navigationTiming.emitAsiaFirstPaint();

		assert.deepEqual(
			stub.getCall( 0 ) && stub.getCall( 0 ).args,
			[ 'timing.frontend.navtiming_asia.firstPaint', 600 ],
			'First paint'
		);
		assert.deepEqual(
			stub.getCall( 1 ) && stub.getCall( 1 ).args,
			[ 'timing.frontend.navtiming_asia.firstContentfulPaint', 640 ],
			'First contentful paint'
		);
	} );

	QUnit.test( 'Asia (sample check)', function ( assert ) {
		var stub = this.sandbox.stub( window, 'Geo', {
			country: 'HK'
		} );

		this.sandbox.stub( window, 'chrome', {
			loadTimes: function () {}
		} );

		this.sandbox.stub( window, 'performance', {
			timing: performance.timing,
			navigation: {
				// Force TYPE_NAVIGATE instead of e.g. TYPE_REDIRECT.
				// Since we only collect metrics from regular requests,
				// but we don't want that logic to apply to the unit test,
				// as otherwise it may omit the main Navigation Timing keys.
				type: 0,
				redirectCount: 0
			}
		} );

		navigationTiming.reinit();

		assert.strictEqual(
			navigationTiming.inAsiaSample(),
			true,
			'Is in Asia sample'
		);

		stub.restore();

		this.sandbox.stub( window, 'Geo', {
			country: 'FR'
		} );

		assert.strictEqual(
			navigationTiming.inAsiaSample(),
			false,
			'Is not in Asia sample'
		);
	} );

	QUnit.test( 'Oversample config and activation', function ( assert ) {
		// If navigation type is anything other than TYPE_NAVIGATE, the
		// check for whether to measure will fail.
		this.sandbox.stub( window, 'performance', {
			timing: performance.timing,
			navigation: {
				type: 0,
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
}( mediaWiki ) );
