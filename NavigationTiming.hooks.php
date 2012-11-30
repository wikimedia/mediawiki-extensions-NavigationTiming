<?php
/**
 * Hooks for NavigationTiming extension
 *
 * @file
 * @ingroup Extensions
 */

class NavigationTimingHooks {

	/* Static Methods */

	/**
	 * BeforePageDisplay hook
	 * Adds the modules to the page
	 *
	 * @param $out OutputPage output page
	 * @param $skin Skin current skin
	 * @return Boolean: always true
	 */
	public static function beforePageDisplay( $out, $skin ) {
		$out->addModules( 'jquery.NavigationTiming' );
		return true;
	}
}
