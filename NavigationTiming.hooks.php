<?php

class NavigationTimingHooks {
	public static function onBeforePageDisplay( &$out, &$skin ) {
		$out->addModules( 'ext.navigationTiming' );
	}

	public static function onResourceLoaderGetConfigVars( &$vars ) {
		global $wgNavigationTimingSamplingFactor, $wgNavigationTimingOversampleFactor,
			$wgNavigationTimingSurveySamplingFactor, $wgNavigationTimingSurveyName,
			$wgNavigationTimingCpuBenchmarkSamplingFactor;

		$vars[ 'wgNavigationTimingSamplingFactor' ] = $wgNavigationTimingSamplingFactor;
		$vars[ 'wgNavigationTimingSurveySamplingFactor' ] = $wgNavigationTimingSurveySamplingFactor;
		$vars[ 'wgNavigationTimingSurveyName' ] = $wgNavigationTimingSurveyName;
		$vars[ 'wgNavigationTimingCpuBenchmarkSamplingFactor' ] =
			$wgNavigationTimingCpuBenchmarkSamplingFactor;

		// Filter to ensure that all values are reasonable.  This allows us to
		// not filter on the client side
		$oversampleFactor = $wgNavigationTimingOversampleFactor;
		if ( $oversampleFactor && is_array( $oversampleFactor ) ) {
			foreach ( $oversampleFactor as &$factor ) {
				$factor = array_filter( $factor, function ( $val, $term ) {
					if ( !is_int( $val ) || $val < 1 ) {
						\MediaWiki\Logger\LoggerFactory::getInstance( 'NavigationTiming' )->error(
							'Invalid sample value for NavTiming \'{term}\': {val}', [
								'term' => $term,
								'val' => $val
							] );
						return false;
					}
					return true;
				}, ARRAY_FILTER_USE_BOTH );
			}
		} else {
			$oversampleFactor = false;
		}
		$vars[ 'wgNavigationTimingOversampleFactor' ] = $oversampleFactor;
	}
}
