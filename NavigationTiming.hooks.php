<?php

class NavigationTimingHooks {
	public static function onBeforePageDisplay( &$out, &$skin ) {
		$out->addModules( 'ext.navigationTiming' );
	}

	public static function onResourceLoaderGetConfigVars( &$vars ) {
		global $wgNavigationTimingSamplingFactor, $wgNavigationTimingOversampleFactor;
		$vars[ 'wgNavigationTimingSamplingFactor' ] = $wgNavigationTimingSamplingFactor;

		// Filter to ensure that all values are reasonable.  This allows us to
		// not filter on the client side
		$oversampleFactor = $wgNavigationTimingOversampleFactor;
		if ( $oversampleFactor && is_array( $oversampleFactor ) ) {
			foreach ( $oversampleFactor as &$factor ) {
				$factor = wfArrayFilter( $factor, function ( $val, $term ) {
					if ( !is_int( $val ) || $val < 1 ) {
						\MediaWiki\Logger\LoggerFactory::getInstance( 'NavigationTiming' )->error(
							'Invalid sample value for NavTiming \'{term}\': {val}', [
								'term' => $term,
								'val' => $val
							] );
						return false;
					}
					return true;
				} );
			}
		} else {
			$oversampleFactor = false;
		}
		$vars[ 'wgNavigationTimingOversampleFactor' ] = $oversampleFactor;
	}

	public static function onResourceLoaderTestModules( array &$modules, ResourceLoader &$rl ) {
		$modules['qunit']['ext.navigationTiming.test'] = [
			'scripts' => [ 'tests/ext.navigationTiming.test.js' ],
			'dependencies' => [
				'ext.navigationTiming',
				'schema.NavigationTiming',
				'schema.SaveTiming',
			],
			'localBasePath' => __DIR__ ,
			'remoteExtPath' => 'NavigationTiming',
		];
	}
}
