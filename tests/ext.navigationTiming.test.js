/* global mw */
/* eslint-env qunit */
QUnit.module( 'ext.navigationTiming' );

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
