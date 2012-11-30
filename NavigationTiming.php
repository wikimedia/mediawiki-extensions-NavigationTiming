<?php
/**
 * Navigation Timing extension
 *
 * @file
 * @ingroup Extensions
 *
 * @author Asher Feldman <afeldman@wikimedia.org>
 * @author Patrick Reilly <preilly@wikimedia.org>
 * @license GPL v2 or later
 * @version 0.1.1
 */

if ( !defined( 'MEDIAWIKI' ) ) {
	die( 'This file is a MediaWiki extension, it is not a valid entry point' );
}

/**
 * CONFIGURATION
 * These variables may be overridden in LocalSettings.php after you include the
 * extension file.
 */

/** Setup */
$wgExtensionCredits['other'][] = array(
	'path' => __FILE__,
	'name' => 'NavigationTiming',
	'version' => '0.0.1',
	'url' => 'https://www.mediawiki.org/wiki/Extension:NavigationTiming',
	'author' => array( 'Patrick Reilly', 'Asher Feldman' ),
	'descriptionmsg' => 'navigationtiming_desc',
);

$dir = dirname( __FILE__ ) . '/';
// Autoload classes
$wgAutoloadClasses['NavigationTimingHooks'] = $dir . 'NavigationTiming.hooks.php';

// Hooked functions
$wgHooks['BeforePageDisplay'][] = 'NavigationTimingHooks::beforePageDisplay';

// i18n
$wgExtensionMessagesFiles['NavigationTiming'] = $dir . 'NavigationTiming.i18n.php';

// Resource modules
$ctResourceTemplate = array(
	'localBasePath' => $dir . 'modules',
	'remoteExtPath' => 'NavigationTiming/modules',
);
$wgResourceModules['jquery.NavigationTiming'] = array(
	'scripts' => array( 'jquery.crypt.js', 'ext.navigationTiming.js' ),
) + $ctResourceTemplate;
