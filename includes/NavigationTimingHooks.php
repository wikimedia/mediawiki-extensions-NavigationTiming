<?php

class NavigationTimingHooks {
	/**
	 * @param OutputPage &$out
	 * @param Skin &$skin
	 */
	public static function onBeforePageDisplay( &$out, &$skin ) {
		$out->addModules( 'ext.navigationTiming' );
	}
}
