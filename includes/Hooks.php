<?php

namespace MediaWiki\Extension\NavigationTiming;

use MediaWiki\Output\Hook\BeforePageDisplayHook;
use MediaWiki\Output\OutputPage;
use Skin;

class Hooks implements BeforePageDisplayHook {
	/**
	 * @param OutputPage $out
	 * @param Skin $skin
	 */
	public function onBeforePageDisplay( $out, $skin ): void {
		$out->addModules( 'ext.navigationTiming' );
	}
}
