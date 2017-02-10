<?php

class NavigationTimingHooks {

	public static function onBeforePageDisplay( &$out, &$skin ) {
		$out->addModules( 'ext.navigationTiming' );
		return true;
	}

	public static function onResourceLoaderGetConfigVars( &$vars ) {
		global $wgNavigationTimingSamplingFactor;
		$vars[ 'wgNavigationTimingSamplingFactor' ] = $wgNavigationTimingSamplingFactor;
		return true;
	}

	public static function onResourceLoaderTestModules( array &$modules, ResourceLoader &$rl ) {
		$modules['qunit']['ext.navigationTiming.test'] = [
			'scripts' => [ 'tests/ext.navigationTiming.test.js' ],
			'dependencies' => [ 'ext.navigationTiming' ],
			'localBasePath' => __DIR__ ,
			'remoteExtPath' => 'NavigationTiming',
		];
	}
}
