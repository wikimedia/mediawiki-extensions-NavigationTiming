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
 * @version 0.1.1
 */

$wgExtensionCredits['other'][] = array(
	'path' => __FILE__,
	'name' => 'NavigationTiming',
	'version' => '0.1.0',
	'url' => 'https://www.mediawiki.org/wiki/Extension:NavigationTiming',
	'author' => array(
		'Asher Feldman',
		'Ori Livneh',
		'Patrick Reilly',
	),
	'descriptionmsg' => 'navigationtiming-desc',
);

/** @var int|bool: If set, logs once per this many requests. False if unset. **/
$wgNavigationTimingSamplingFactor = false;

/** @var int|bool: Percent of users who should be routed to the HHVM cluster. False if unset. **/
$wgPercentHHVM = false;

$wgMessagesDirs['NavigationTiming'] = __DIR__ . '/i18n';
$wgExtensionMessagesFiles[ 'NavigationTiming' ] = __DIR__ . '/NavigationTiming.i18n.php';

$wgResourceModules += array(
	'ext.navigationTiming' => array(
		'scripts'       => array(
			'ext.navigationTiming.js',
			'ext.navigationTiming.HHVM.js',
		),
		'localBasePath' => __DIR__ . '/modules',
		'remoteExtPath' => 'NavigationTiming/modules',
		'dependencies'  => array(
			'schema.NavigationTiming',
			'schema.SaveTiming',
			'json',
		),
		'targets'       => array( 'desktop', 'mobile' ),
	)
);

$wgEventLoggingSchemas[ 'NavigationTiming' ] = 10076863;
$wgEventLoggingSchemas[ 'SaveTiming' ] = 10077760;

$wgHooks[ 'BeforePageDisplay' ][] = function ( &$out, &$skin ) {
	$out->addModules( 'ext.navigationTiming' );
	return true;
};

$wgHooks[ 'ResourceLoaderGetConfigVars' ][] = function ( &$vars ) {
	global $wgNavigationTimingSamplingFactor, $wgPercentHHVM;
	$vars[ 'wgNavigationTimingSamplingFactor' ] = $wgNavigationTimingSamplingFactor;
	$vars[ 'wgPercentHHVM' ] = $wgPercentHHVM;
	return true;
};
