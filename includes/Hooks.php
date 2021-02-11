<?php

namespace MediaWiki\Extension\NavigationTiming;

use OutputPage;
use Skin;

class Hooks {
	/**
	 * @param OutputPage &$out
	 * @param Skin &$skin
	 */
	public static function onBeforePageDisplay( &$out, &$skin ) {
		$out->addModules( 'ext.navigationTiming' );
	}
}
