<?php

namespace Tests\NavigationTiming\Structure;

/**
 * @group NavigationTiming
 */
class NavigationTimingBundleSizeTest extends \MediaWiki\Tests\Structure\BundleSizeTestBase {

	/** @inheritDoc */
	public function getBundleSizeConfig(): string {
		return dirname( __DIR__, 3 ) . '/bundlesize.config.json';
	}
}
