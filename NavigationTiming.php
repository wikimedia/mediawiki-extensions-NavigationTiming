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

// i18n
$wgExtensionMessagesFiles['NavigationTiming'] = $dir . 'NavigationTiming.i18n.php';
