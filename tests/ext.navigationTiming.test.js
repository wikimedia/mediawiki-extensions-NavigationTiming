/* global mw */
/* eslint-env qunit */
QUnit.module( 'ext.navigationTiming', QUnit.newMwEnvironment( {
	setup: function () {
		mw.config.set( 'wgNavigationTimingFirstPaintAsiaSamplingFactor', 1 );
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
	},
	teardown: function() {
		window.Geo = this.Geo;
		window.chrome = this.chrome;
	}
} ) );

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
	require( 'ext.navigationTiming' ).reinit();

	stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
	require( 'ext.navigationTiming' ).emitNavTiming();

	assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called' );
	assert.equal( stub.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );

	event = stub.getCall( 0 ).args[ 1 ];
	expected = {
		// Base
		isAnon: 'boolean',
		isHiDPI: 'boolean',
		isHttp2: 'boolean',
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
			requestStart: 250,
			responseStart: 300,
			responseEnd: 400,
			domComplete: 450,
			loadEventStart: 570,
			loadEventEnd: 575
		},
		navigation: {
			// type: TYPE_NAVIGATE
			type: 0,
			redirectCount: 0
		}
	} );
	require( 'ext.navigationTiming' ).reinit();
	stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
	require( 'ext.navigationTiming' ).emitNavTiming();
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
		loadEventEnd: [ 'number', 475 ]
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
			requestStart: 110,
			responseStart: 200,
			responseEnd: 300,
			domComplete: 350,
			loadEventStart: 470,
			loadEventEnd: 475
		},
		navigation: {
			// type: TYPE_NAVIGATE
			type: 0,
			redirectCount: 0
		}
	} );
	require( 'ext.navigationTiming' ).reinit();
	stub = this.sandbox.stub( mw.eventLog, 'logEvent' );
	require( 'ext.navigationTiming' ).emitNavTiming();
	assert.ok( stub.calledOnce, 'mw.eventLog.logEvent was called' );
	assert.equal( stub.getCall( 0 ).args[ 0 ], 'NavigationTiming', 'Schema name' );
	event = stub.getCall( 0 ).args[ 1 ];

	expected = {
		dnsLookup: [ 'number', 0 ],
		connectStart: [ 'number', 0 ],
		secureConnectionStart: [ 'undefined' ],
		connectEnd: [ 'number', 0 ],
		requestStart: [ 'number', 10 ],
		responseStart: [ 'number', 100 ],
		responseEnd: [ 'number', 200 ],
		domComplete: [ 'number', 250 ],
		loadEventStart: [ 'number', 370 ],
		loadEventEnd: [ 'number', 375 ]
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
	require( 'ext.navigationTiming' ).reinit();
	require( 'ext.navigationTiming' ).emitAsiaFirstPaint();

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
	require( 'ext.navigationTiming' ).reinit();
	require( 'ext.navigationTiming' ).emitAsiaFirstPaint();

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
	var stub;

	this.sandbox.stub( window, 'chrome', {
		loadTimes: function() {}
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

	require( 'ext.navigationTiming' ).reinit();

	stub = this.sandbox.stub( window, 'Geo', {
		country: 'HK'
	} );

	assert.strictEqual(
		require( 'ext.navigationTiming' ).inAsiaSample(),
		true,
		'Is in Asia sample'
	);

	stub.restore();

	this.sandbox.stub( window, 'Geo', {
		country: 'FR'
	} );

	assert.strictEqual(
		require( 'ext.navigationTiming' ).inAsiaSample(),
		false,
		'Is not in Asia sample'
	);
} );
