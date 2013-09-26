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
	'version' => '0.0.1',
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

$wgExtensionMessagesFiles[ 'NavigationTiming' ] = __DIR__ . '/NavigationTiming.i18n.php';

$wgResourceModules += array(
	'schema.NavigationTiming' => array(
		'class'         => 'ResourceLoaderSchemaModule',
		'schema'        => 'NavigationTiming',
		'revision'      => 5832704,
		'targets'       => array( 'desktop', 'mobile' ),
	),
	'ext.navigationTiming' => array(
		'scripts'       => 'ext.navigationTiming.js',
		'localBasePath' => __DIR__ . '/modules',
		'remoteExtPath' => 'NavigationTiming/modules',
		'dependencies'  => 'schema.NavigationTiming',
		'targets'       => array( 'desktop', 'mobile' ),
	)
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
