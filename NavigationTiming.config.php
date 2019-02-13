<?php

class NavigationTimingConfig {
	/**
	 * Get config vars to export with the ext.navigationTiming module.
	 *
	 * @param ResourceLoaderContext $context
	 * @return array
	 */
	public static function getNavigationTimingConfigVars( ResourceLoaderContext $context ) {
		$contextConfig = $context->getConfig();

		$config = [
			'samplingFactor' =>
				$contextConfig->get( 'NavigationTimingSamplingFactor' ),
			'surveySamplingFactor' =>
				$contextConfig->get( 'NavigationTimingSurveySamplingFactor' ),
			'surveyAuthenticatedSamplingFactor' =>
				$contextConfig->get( 'NavigationTimingSurveyAuthenticatedSamplingFactor' ),
			'surveyName' =>
				$contextConfig->get( 'NavigationTimingSurveyName' ),
			'cpuBenchmarkSamplingFactor' =>
				$contextConfig->get( 'NavigationTimingCpuBenchmarkSamplingFactor' ),
		];

		// Filter to ensure that all values are reasonable.  This allows us to
		// not filter on the client side
		$oversampleFactor = $contextConfig->get( 'NavigationTimingOversampleFactor' );
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

		$config[ 'oversampleFactor' ] = $oversampleFactor;

		return $config;
	}
}
