<?php

class NavigationTimingHooks {
	public static function onBeforePageDisplay( &$out, &$skin ) {
		$out->addModules( 'ext.navigationTiming' );
	}

	public static function onResourceLoaderGetConfigVars( &$vars ) {
		global $wgNavigationTimingSamplingFactor, $wgNavigationTimingFirstPaintAsiaSamplingFactor;
		$vars[ 'wgNavigationTimingSamplingFactor' ] = $wgNavigationTimingSamplingFactor;
		$vars[ 'wgNavigationTimingFirstPaintAsiaSamplingFactor' ] =
		$wgNavigationTimingFirstPaintAsiaSamplingFactor;
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
