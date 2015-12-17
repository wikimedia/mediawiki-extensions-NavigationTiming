<?php

class NavigationTimingHooks {

	public static function onBeforePageDisplay ( &$out, &$skin ) {
		$out->addModules( 'ext.navigationTiming' );
		return true;
	}

	public static function onResourceLoaderGetConfigVars ( &$vars ) {
		global $wgNavigationTimingSamplingFactor;
		$vars[ 'wgNavigationTimingSamplingFactor' ] = $wgNavigationTimingSamplingFactor;
		return true;
	}


}
