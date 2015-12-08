<?php
/**
 * Navigation Timing extension
 *
 * @file
 * @ingroup Extensions
 *
 * @author Asher Feldman <afeldman@wikimedia.org>
 * @author Ori Livneh <ori@wikimedia.org>
 * @author Patrick Reilly <preilly@php.net>
 *
 * @license GPL v2 or later
 * @version 1.0
 */

$wgExtensionCredits['other'][] = array(
	'path' => __FILE__,
	'name' => 'NavigationTiming',
	'version' => '1.0',
	'url' => 'https://www.mediawiki.org/wiki/Extension:NavigationTiming',
	'author' => array(
		'Asher Feldman',
		'Ori Livneh',
		'Patrick Reilly',
	),
	'descriptionmsg' => 'navigationtiming-desc',
	'license-name' => 'GPL-2.0+',
);

/** @var int|bool: If set, logs once per this many requests. False if unset. **/
$wgNavigationTimingSamplingFactor = false;

$wgMessagesDirs['NavigationTiming'] = __DIR__ . '/i18n';
$wgExtensionMessagesFiles[ 'NavigationTiming' ] = __DIR__ . '/NavigationTiming.i18n.php';

$wgResourceModules += array(
	'ext.navigationTiming' => array(
		'scripts'       => array(
			'ext.navigationTiming.js',
		),
		'localBasePath' => __DIR__ . '/modules',
		'remoteExtPath' => 'NavigationTiming/modules',
		'dependencies'  => array(
			'schema.NavigationTiming',
			'schema.SaveTiming',
			'json',
			'jquery.cookie',
		),
		'targets'       => array( 'desktop', 'mobile' ),
	)
);

if ( !isset( $wgEventLoggingSchemas ) ) {
	$wgEventLoggingSchemas = array();
}
$wgEventLoggingSchemas += array(
	'NavigationTiming' => 15033442,
	'SaveTiming'       => 12236257,
);

$wgHooks[ 'BeforePageDisplay' ][] = function ( &$out, &$skin ) {
	$out->addModules( 'ext.navigationTiming' );
	return true;
};

$wgHooks[ 'ResourceLoaderGetConfigVars' ][] = function ( &$vars ) {
	global $wgNavigationTimingSamplingFactor;
	$vars[ 'wgNavigationTimingSamplingFactor' ] = $wgNavigationTimingSamplingFactor;
	return true;
};
