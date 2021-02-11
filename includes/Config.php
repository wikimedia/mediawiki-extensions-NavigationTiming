<?php

namespace MediaWiki\Extension\NavigationTiming;

use MediaWiki\Logger\LoggerFactory;
use ResourceLoaderContext;

class Config {
	/**
	 * Get config vars to export with the ext.navigationTiming module.
	 *
	 * @param ResourceLoaderContext $context
	 * @param \Config $config
	 * @return array
	 */
	public static function getNavigationTimingConfigVars(
		ResourceLoaderContext $context,
		\Config $config
	) {
		$configVars = [
			'samplingFactor' =>
				$config->get( 'NavigationTimingSamplingFactor' ),
			'surveySamplingFactor' =>
				$config->get( 'NavigationTimingSurveySamplingFactor' ),
			'surveyAuthenticatedSamplingFactor' =>
				$config->get( 'NavigationTimingSurveyAuthenticatedSamplingFactor' ),
			'surveyName' =>
				$config->get( 'NavigationTimingSurveyName' ),
			'cpuBenchmarkSamplingFactor' =>
				$config->get( 'NavigationTimingCpuBenchmarkSamplingFactor' ),
		];

		// Filter to ensure that all values are reasonable.  This allows us to
		// not filter on the client side
		$oversampleFactor = $config->get( 'NavigationTimingOversampleFactor' );
		if ( $oversampleFactor && is_array( $oversampleFactor ) ) {
			foreach ( $oversampleFactor as $key => &$factor ) {
				// wiki oversampling is just an integer
				if ( $key == 'wiki' && is_int( $factor ) ) {
					continue;
				}

				$factor = array_filter( $factor, function ( $val, $term ) {
					if ( !is_int( $val ) || $val < 1 ) {
						LoggerFactory::getInstance( 'NavigationTiming' )->error(
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

		$configVars[ 'oversampleFactor' ] = $oversampleFactor;
		return $configVars;
	}
}
