( function ( mw, $ ) {
	'use strict';

	var hasCookie = /hhvm=true/.test( document.cookie );

	if ( mw.config.exists( 'wgUserId' ) ) {
		return;
	}

	/**
	 * Get the random seed value that we'll use to determine bucket assignment.
	 * If it is unset, generate it.
	 *
	 * @return {number}
	 */
	function getSeed() {
		var id;
		try {
			id = JSON.parse( localStorage.getItem( 'hSeed' ) );
			if ( typeof id !== 'number' ) {
				id = Math.floor( Math.random() * 1e10 );
				localStorage.setItem( 'hSeed', id );
			}
			return id;
		} catch ( e ) {}
	}


	/**
	 * Determine if the user is in the HHVM sample or not.
	 *
	 * @return {boolean}
	 */
	function inSample() {
		var seed = getSeed(), percent = mw.config.get( 'wgPercentHHVM' );
		if ( !$.isNumeric( seed ) || !$.isNumeric( percent ) || percent > 100 || percent < 0 ) {
			return false;
		}
		return ( getSeed() / percent ) % 100 <= percent;
	}

	if ( inSample() ) {
		if ( !hasCookie ) {
			$.cookie( 'hhvm', 'true', { expires: 7, path: '/' } );
		}
	} else {
		if ( hasCookie ) {
			$.removeCookie( 'hhvm', { path: '/' } );
		}
	}
} ( mediaWiki, jQuery ) );
